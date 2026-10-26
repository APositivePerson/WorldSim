"""场景插件：从 scenarios/<场景id>/ 读取场景信息。

每个场景一个文件夹，里面有：
- scene.json     地点、物体、员工角色、业务规则、给顾客/员工的补充说明、排队流程、2D/3D 坐标
- personas.json  这个场景的顾客人设

大脑和员工 Agent 的提示词、动作可用的目标，都从这里生成，代码里不再写死"银行"。
换场景时只需要新建一个文件夹，用环境变量 SCENARIO 或启动参数 --scenario 选择。
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from functools import lru_cache

import config
from protocol import ACTIONS

SCENARIOS_DIR = config.ROOT / "scenarios"
DEFAULT_SCENARIO = os.getenv("SCENARIO", "bank")


@dataclass
class Capabilities:
    """这一场顾客实际能用的动作和目标：场景提供什么 ∩ 身体能做什么。"""
    actions: list[str]
    places: list[str]        # walk_to 的目标
    look_targets: list[str]  # look_at / point_to 的目标

    def allows(self, action: str, target: str | None) -> str | None:
        """合法返回 None，不合法返回原因。"""
        if action not in self.actions:
            return f"当前身体不支持动作 {action}"
        kind = ACTIONS[action][1]
        if kind == "place" and target not in self.places:
            return f"动作 {action} 的目标 {target} 不在可去的地点里"
        if kind == "look" and target not in self.look_targets:
            return f"动作 {action} 的目标 {target} 不在可看的目标里"
        return None

    def to_dict(self) -> dict:
        return {"actions": self.actions, "places": self.places, "look_targets": self.look_targets}


class Scenario:
    def __init__(self, scene_id: str, data: dict, personas: dict):
        self.id = scene_id
        self.data = data
        self.personas = personas
        self.name: str = data["name"]
        self.places: dict[str, str] = {k: v["label"] for k, v in data["places"].items()}
        self.objects: dict[str, str] = {k: v["label"] for k, v in data.get("objects", {}).items()}
        self.staff: dict[str, dict] = data["staff"]
        self.greeter: str = data.get("greeter") or next(iter(self.staff))
        self.workflow: dict | None = data.get("workflow")

    # ---------- 能力 ----------
    def profile(self, name: str | None) -> dict:
        return self.data.get("profiles", {}).get(name or "", {})

    def capabilities(self, profile: str | None = None, declared: dict | None = None) -> Capabilities:
        """默认：动作库全部动作、场景全部地点。身体在 hello 里声明了能力时取交集。"""
        actions = list(ACTIONS)
        places = list(self.places)
        looks = places + list(self.objects)
        for source in (self.profile(profile).get("capabilities"), declared):
            if not source:
                continue
            if "actions" in source:
                actions = [a for a in actions if a in source["actions"]]
            if "places" in source:
                places = [p for p in places if p in source["places"]]
            if "look_targets" in source:
                looks = [t for t in looks if t in source["look_targets"]]
        if not places:
            actions = [a for a in actions if ACTIONS[a][1] != "place"]
        if not looks:
            actions = [a for a in actions if ACTIONS[a][1] != "look"]
        if "wait" not in actions:
            actions.insert(0, "wait")
        return Capabilities(actions, places, looks)

    def start_place(self, profile: str | None = None) -> str:
        return self.profile(profile).get("start") or self.data.get("start") or next(iter(self.places))

    def label(self, key: str | None) -> str:
        return self.places.get(key or "") or self.objects.get(key or "") or (key or "")

    # ---------- 员工 ----------
    def on_duty(self, location: str) -> str | None:
        """在这个地点负责接待的员工。"""
        for key, s in self.staff.items():
            if location in s.get("places", []):
                return key
        return None

    def fix_speaker(self, speaker: str, location: str) -> str:
        """员工只能在自己的岗位附近和顾客说话；不在岗位附近时改由迎宾（一般是机器人）说。"""
        if speaker not in self.staff or speaker == self.greeter:
            return speaker
        return speaker if location in self.staff[speaker].get("places", []) else self.greeter

    def staff_label(self, speaker: str, location: str | None = None) -> str:
        s = self.staff.get(speaker, {})
        label = s.get("label", speaker)
        if location and speaker != self.greeter and location in s.get("places", []):
            label += f"（{self.label(location)}）"
        return label

    def staff_voice(self, speaker: str) -> dict:
        return self.staff.get(speaker, {}).get("voice") or {"voice": "zh-CN-XiaoyiNeural"}

    # ---------- 提示词片段 ----------
    def customer_section(self, caps: Capabilities, profile: str | None = None) -> str:
        notes = self.data.get("customer_notes", []) + self.profile(profile).get("customer_notes", [])
        lines = [f"## 场景：{self.name}",
                 f"你是{self.data.get('customer_role', '顾客')}。{self.data.get('intro', '')}",
                 f"你一开始在 {self.start_place(profile)}（{self.label(self.start_place(profile))}）。"]
        if caps.places:
            lines.append("\n你能走到的地点（key：说明）：")
            lines += [f"- {k}：{self.places[k]}" for k in caps.places]
        else:
            lines.append("\n这一场你不能走动，只能原地交流。")
        lines.append(_action_list(caps, self.data.get("action_notes", {})))
        if caps.look_targets and any(ACTIONS[a][1] == "look" for a in caps.actions):
            lines.append("look_at / point_to 的 target 只能是：" + "、".join(
                f"{t}（{self.label(t)}）" for t in caps.look_targets))
        if notes:
            lines.append("\n## 这个场景的补充说明")
            lines += [f"- {n}" for n in notes]
        return "\n".join(lines)

    def staff_section(self, profile: str | None = None, caps: Capabilities | None = None) -> str:
        """caps：顾客这一场能去的地点。员工只会把顾客引导到这些地点（比如 3D 场景里没有 3 号柜台）。"""
        roles = "\n".join(f"- {k}：{s['label']}。{s['duties']}" for k, s in self.staff.items())
        keys = caps.places if caps else list(self.places)
        places = "\n".join(f"- {k}：{self.places[k]}" for k in keys) or "- 顾客这一场不能走动"
        rules = "\n".join(f"- {r}" for r in self.data.get("rules", []))
        notes = self.data.get("staff_notes", []) + self.profile(profile).get("staff_notes", [])
        text = (f"## 场景：{self.name}\n\n## 你扮演的工作人员（speaker 只能是这些 key，或 none）\n{roles}\n\n"
                f"## 场景里的地点\n{places}\n\n## 业务规定（工作人员要按这些规定办事）\n{rules or '- 无'}")
        if notes:
            text += "\n\n## 补充说明\n" + "\n".join(f"- {n}" for n in notes)
        return text


def _action_list(caps: Capabilities, notes: dict) -> str:
    lines = ["\n## 你能做的动作（key：说明）"]
    for a in caps.actions:
        desc, kind = ACTIONS[a]
        extra = f"（{notes[a]}）" if a in notes else ""
        target = {"place": "，target 填地点 key", "look": "，target 填可看的目标"}.get(kind, "")
        lines.append(f"- {a}：{desc}{extra}{target}")
    lines.append("其它动作 target 填 null。")
    return "\n".join(lines)


@lru_cache(maxsize=None)
def load_scenario(scene_id: str = DEFAULT_SCENARIO) -> Scenario:
    folder = SCENARIOS_DIR / scene_id
    if not (folder / "scene.json").exists():
        available = sorted(p.name for p in SCENARIOS_DIR.iterdir() if (p / "scene.json").exists())
        raise RuntimeError(f"没有这个场景：{scene_id}，可选 {available}")
    data = json.loads((folder / "scene.json").read_text(encoding="utf-8"))
    personas_file = folder / "personas.json"
    personas = json.loads(personas_file.read_text(encoding="utf-8")) if personas_file.exists() else {}
    return Scenario(scene_id, data, personas)
