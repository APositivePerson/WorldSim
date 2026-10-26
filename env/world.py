"""简易 2D 环境：只负责状态和规则，不负责画面。

地点、坐标、员工岗位、排队流程都来自场景文件（scenario.py），这里不写死"银行"。
坐标单位是像素（地图 760x560），取自场景文件里每个地点的 pos2d。Agent 只看到地点名，看不到坐标。
"""
from __future__ import annotations

import math
import random

from protocol import ACTION_LABELS, AgentAction, Event
from scenario import Scenario, load_scenario

WALK_SPEED = 110.0  # 像素/秒
# 原地动作的持续时间（秒）
DURATIONS = {
    "nod": 1.0, "shake_head": 1.0, "wave": 1.5, "point_to": 1.5,
    "look_at": 1.0, "hand_over": 1.5, "take": 1.5, "sit": 1.0, "stand_up": 1.0,
}
QUEUE_SECONDS_PER_PERSON = 8   # 叫号时每个排在前面的人算几秒，调小可以加快测试
# 这些动作会让银行端（柜员/机器人）注意到并可能回应
NOTICEABLE_ACTIONS = {"wave", "hand_over", "take", "point_to"}


class World2D:
    def __init__(self, scenario: Scenario | None = None):
        self.scenario = sc = scenario or load_scenario()
        # 只有写了 pos2d 的地点才能在 2D 环境里去
        self.positions: dict[str, tuple[float, float]] = {
            k: tuple(v["pos2d"]) for k, v in sc.data["places"].items() if "pos2d" in v}
        self.look_positions = {**self.positions, **{
            k: tuple(v["pos2d"]) for k, v in sc.data.get("objects", {}).items() if "pos2d" in v}}
        self.robot_pos = self.look_positions.get(sc.greeter) or self.positions[sc.start_place()]
        start = sc.start_place()
        self.time = 0.0
        self.pos = list(self.positions[start])
        self.location = start
        self.posture = "standing"
        self.facing = self.robot_pos
        self.current: AgentAction = AgentAction()
        self.remaining = 0.0              # 当前原地动作剩余时间
        self.walk_target: str | None = None
        self.ticket_no: str | None = None
        self.call_at: float | None = None  # 什么时候叫到这个号
        self.called_counter: str | None = None
        self.finished = False
        here = sc.label(start)
        self.pending: list[Event] = [Event("scene_start", f"你来到了{sc.name}，站在{here}。", 0.0)]
        # 给员工端看的顾客动态：(文本, 是否需要员工考虑回应)
        self.bank_notes: list[tuple[str, bool]] = [(f"一位顾客来到了{sc.name}，站在{here}。", True)]

    def place_label(self, key: str | None) -> str:
        return self.scenario.label(key)

    # ---------- 发给大脑的信息 ----------
    def state(self) -> dict:
        """人物当前状态，随每个事件一起发给大脑。"""
        return {
            "time": round(self.time, 1),
            "location": "moving" if self.walk_target else self.location,
            "posture": self.posture,
            "current_action": self.current.action,
        }

    def drain_events(self) -> list[Event]:
        events, self.pending = self.pending, []
        return events

    def drain_bank_notes(self) -> list[tuple[str, bool]]:
        notes, self.bank_notes = self.bank_notes, []
        return notes

    def apply(self, act: AgentAction) -> None:
        """执行 Agent 的动作。新动作会打断还没做完的动作。"""
        if act.goal_status in ("done", "give_up") and not self.finished:
            self.finished = True
            self.bank_notes.append(("顾客表示要离开了。" if act.goal_status == "done"
                                    else "顾客不耐烦，放弃办理，准备离开。", True))
        name, target = act.action, act.target
        # wait 表示"不换动作"，只说话，不打断正在走的路
        if name == "wait":
            return
        if name == "walk_to":
            self.bank_notes.append((f"顾客开始走向{self.place_label(target)}。", False))
        elif name in ACTION_LABELS:
            where = f"（在{self.place_label(self.location) if self.location != 'moving' else '路上'}）"
            to = f"：{self.place_label(target)}" if target else ""
            self.bank_notes.append((f"顾客{ACTION_LABELS[name]}{to}{where}", name in NOTICEABLE_ACTIONS))
        self.current = act
        self.walk_target = None
        self.remaining = 0.0
        if self.location == "moving":
            # 走到一半被打断，就近算作在某个地点附近
            self.location = min(self.positions, key=lambda k: self._dist(self.positions[k]))

        if name == "walk_to":
            if target not in self.positions:
                self._fail(f"{self.place_label(target)}在这个环境里去不了。")
                return
            if self._dist(self.positions[target]) < 1:
                self._done(f"你已经在{self.place_label(target)}了。")
                return
            self.posture = "standing"   # 坐着时会自动站起来
            self.walk_target = target
            self.location = "moving"
            self.facing = self.positions[target]
            return
        seats = (self.scenario.workflow or {}).get("seat_places") or [(self.scenario.workflow or {}).get("waiting_place")]
        if name == "sit" and self.location not in seats:
            self._fail("这里没有座椅，不能坐下。")
            return
        if name == "sit" and self.posture == "sitting":
            self._fail("你已经坐着了。")
            return
        if name == "stand_up" and self.posture == "standing":
            self._fail("你本来就站着。")
            return
        if name in ("look_at", "point_to"):
            self.facing = self.look_positions.get(target, self.facing)
        self.remaining = DURATIONS.get(name, 1.0)

    # ---------- 场景里其他人/系统 ----------
    def add_event(self, type_: str, text: str) -> Event:
        ev = Event(type_, text, round(self.time, 1))
        self.pending.append(ev)
        return ev

    def update(self, dt: float) -> None:
        self.time += dt
        if self.call_at is not None and self.time >= self.call_at:
            self.call_at = None
            services = [p for p in self.scenario.workflow["service_places"] if p in self.positions]
            self.called_counter = random.choice(services)
            text = f"请{self.ticket_no}号顾客到{self.place_label(self.called_counter)}办理业务。"
            self.add_event("broadcast", text)
            self.bank_notes.append((f"大厅广播叫号：{text}", False))
        if self.walk_target:
            tx, ty = self.positions[self.walk_target]
            d = self._dist((tx, ty))
            step = WALK_SPEED * dt
            if d <= step:
                self.pos = [tx, ty]
                self.location = self.walk_target
                self.walk_target = None
                greeter_places = self.scenario.staff.get(self.scenario.greeter, {}).get("places", [])
                self.facing = self.robot_pos if self.location in greeter_places else self.facing
                self._done(f"你走到了{self.place_label(self.location)}。")
                self.bank_notes.append((f"顾客走到了{self.place_label(self.location)}。", True))
            else:
                self.pos[0] += (tx - self.pos[0]) / d * step
                self.pos[1] += (ty - self.pos[1]) / d * step
        elif self.remaining > 0:
            self.remaining -= dt
            if self.remaining <= 0:
                self._finish_inplace()

    # ---------- 内部 ----------
    def _finish_inplace(self) -> None:
        name = self.current.action
        if name == "sit":
            self.posture = "sitting"
            self._done(f"你在{self.place_label(self.location)}坐下了。")
        elif name == "stand_up":
            self.posture = "standing"
            self._done("你站了起来。")
        elif (name == "take" and self.scenario.workflow and not self.ticket_no
              and self.location == self.scenario.workflow["ticket_place"]):
            wf = self.scenario.workflow
            ahead = random.randint(2, 4)
            self.ticket_no = f"{wf.get('ticket_prefix', 'A')}{random.randint(10, 60):03d}"
            self.call_at = self.time + ahead * wf.get("seconds_per_person", QUEUE_SECONDS_PER_PERSON)
            self._done(f"你从{self.place_label(self.location)}取到了号码 {self.ticket_no}，号码纸上写着前面还有 {ahead} 人。")
            self.bank_notes.append((f"顾客取到了号码 {self.ticket_no}，前面还有 {ahead} 人。", True))
        else:
            # 普通小动作做完后不打扰 Agent，直接回到空闲
            self.current = AgentAction(action="wait")

    def _done(self, msg: str) -> None:
        self.current = AgentAction(action="wait")
        self.pending.append(Event("action_done", msg, round(self.time, 1)))

    def _fail(self, msg: str) -> None:
        self.current = AgentAction(action="wait")
        self.pending.append(Event("action_failed", msg, round(self.time, 1)))
        self.bank_notes.append((f"顾客的动作没做成：{msg.replace('你', '顾客')}", False))

    def _dist(self, p) -> float:
        return math.hypot(p[0] - self.pos[0], p[1] - self.pos[1])
