"""员工 Agent：扮演场景里的工作人员（比如银行的服务机器人和柜员），用来和顾客自动对话。

它不是我们要测试的对象，只是"陪练"：代替你一句句打字。以后接入公司真正的机器人后就不需要它了。
每轮只调用一次 LLM，由它决定这一轮谁来说话（某个工作人员 / 都不说）。
有哪些工作人员、业务规定是什么，都来自场景文件，见 scenario.py。
2D 身体和 3D（浏览器）身体共用这一个类。
"""
from __future__ import annotations

import json

import config
from llm import chat_json, make_client, parse_json
from scenario import Capabilities, Scenario

SYSTEM_TEMPLATE = """你在一个服务场景的仿真里，扮演场景里的工作人员，和一位来办事的顾客对话。

{scene}

## 行为要求
- 说话要像真实的工作人员：礼貌、简洁，一次一两句话。
- 由离顾客最近、应该负责的人回应：顾客在哪个工作人员的岗位前，就由那个工作人员回应；不在任何岗位前时由 {greeter} 回应。
- 需要顾客递东西、操作设备时直接说出来，等顾客做完再继续；顾客递出东西（hand_over）就当作收到了。
- 事情办完要明确告诉顾客"已经办好了"。
- 如果顾客只是在走路、在等候，或者刚刚已经回应过，就不要说话，speaker 填 "none"。不要连续催促顾客。
- 顾客报告道路受阻时，结合 navigation 的实际状态回应：局部重规划期间等待，最终失败后可提供合理替代指引或说明需要帮助。不可声称已经移动障碍、顾客已到达或业务已完成；只有身体确认目标恢复可达，才能建议重新尝试同一目标。

## 输入
每次你会收到 JSON：当前时间、顾客的位置和状态、以及刚刚发生的事（顾客说的话、顾客的动作、广播等）。

## 输出
只输出一个 JSON 对象：
{{"thought": "一句话说明你的判断", "speaker": "{speakers} | none", "speech": "要说的话，speaker 为 none 时为空"}}
"""


class StaffAgent:
    def __init__(self, scenario: Scenario, profile: str | None = None, caps: Capabilities | None = None,
                 model: str = config.GLM_MODEL, max_history: int = 40):
        self.scenario = scenario
        self.model = model
        self.max_history = max_history
        self.client = make_client()
        self.system_prompt = SYSTEM_TEMPLATE.format(
            scene=scenario.staff_section(profile, caps), greeter=scenario.greeter,
            speakers=" | ".join(scenario.staff))
        self.history: list[dict] = []

    def decide(self, observation: dict) -> tuple[str, str, str]:
        """返回 (speaker, speech, thought)，speaker 为场景里的员工 key 或 none。"""
        self.history.append({"role": "user", "content": json.dumps(observation, ensure_ascii=False)})
        messages = [{"role": "system", "content": self.system_prompt}] + self.history[-self.max_history:]
        raw = chat_json(self.client, messages, temperature=0.5, model=self.model)
        try:
            data = parse_json(raw)
        except (ValueError, json.JSONDecodeError):
            data = {}
        speaker = data.get("speaker") if data.get("speaker") in self.scenario.staff else "none"
        speech = str(data.get("speech") or "").strip() if speaker != "none" else ""
        if not speech:
            speaker = "none"
        # 员工只能在自己岗位附近说话（比如柜员只在顾客站在柜台前时说话）
        location = (observation.get("customer") or {}).get("location", "")
        if speaker != "none":
            speaker = self.scenario.fix_speaker(speaker, location)
        thought = str(data.get("thought") or "").strip()
        self.history.append({"role": "assistant", "content": json.dumps(
            {"thought": thought, "speaker": speaker, "speech": speech}, ensure_ascii=False)})
        return speaker, speech, thought
