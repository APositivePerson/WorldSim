"""Agent 与环境之间的消息协议。完整说明见 docs/接口文档.md。

以后把环境换成 Unity / 公司的仿真平台时，只要双方仍按这里的格式收发消息，
Agent 这边不需要改动。所有结构都能 to_dict() 成 JSON，方便走 WebSocket。
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field

PROTOCOL_VERSION = 1
DEFAULT_PORT = 8765

# 动作库：名称 -> (说明, 目标类型)。和场景无关；具体能去哪些地点、看哪些东西由场景文件决定（见 scenario.py）。
# 目标类型：None 不需要 target；"place" 是场景里的地点 key；"look" 是地点 key 或场景里的物体 key（如 robot）
ACTIONS: dict[str, tuple[str, str | None]] = {
    "wait": ("原地等待/听对方说话，不做额外动作", None),
    "walk_to": ("走到某个地点", "place"),
    "sit": ("坐下", None),
    "stand_up": ("站起来", None),
    "nod": ("点头", None),
    "shake_head": ("摇头", None),
    "wave": ("挥手（打招呼或叫人）", None),
    "point_to": ("用手指向某处", "look"),
    "look_at": ("看向某处", "look"),
    "hand_over": ("递出东西", None),
    "take": ("接过东西", None),
}

ACTION_LABELS = {
    "walk_to": "走路", "sit": "坐下", "stand_up": "站起", "nod": "点头", "shake_head": "摇头",
    "wave": "挥手", "point_to": "指向", "look_at": "看向", "hand_over": "递出东西", "take": "伸手接东西",
}

GOAL_STATUSES = ("in_progress", "done", "give_up")

# 环境发给 Agent 的事件类型
EVENT_TYPES = (
    "scene_start",      # 场景开始
    "robot_speech",     # 服务机器人说的话
    "teller_speech",    # 柜员说的话
    "broadcast",        # 大厅广播（叫号等）
    "system_message",   # 旁白，测试人员手动注入
    "action_done",      # 顾客的动作完成
    "action_failed",    # 顾客的动作做不了
    "navigation_available",  # 先前受阻目标经身体重新观测后恢复可达
    "time_passed",      # 长时间没有动静
)


@dataclass
class Event:
    """环境发给 Agent 的一件事，type 见 EVENT_TYPES。"""
    type: str
    content: str
    time: float = 0.0


@dataclass
class Observation:
    """Agent 每次决策时看到的全部信息。"""
    time: float
    location: str          # 当前所在地点 key，正在走路时为 "moving"
    posture: str           # standing | sitting
    current_action: str    # 正在执行的动作，空闲时为 "wait"
    events: list[Event] = field(default_factory=list)
    # 已发送命令的实际结果；pending 不代表成功，空列表兼容旧身体。
    action_results: list[dict] = field(default_factory=list)
    vision: dict | None = None  # fresh visual evidence, never physical completion
    navigation: dict | None = None  # compact body-owned execution/recovery state

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class AgentAction:
    """Agent 每轮的输出：一句话 + 一个动作。"""
    speech: str = ""
    action: str = "wait"
    target: str | None = None
    goal_status: str = "in_progress"
    thought: str = ""

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict, caps=None) -> tuple["AgentAction", list[str]]:
        """把 LLM 输出的 dict 转成动作，不合法的字段会被修正并记录错误。

        caps：scenario.Capabilities，这一场实际能用的动作和目标；不传时只检查动作名。
        """
        errors: list[str] = []
        act = cls(
            speech=str(data.get("speech") or "").strip(),
            action=str(data.get("action") or "wait").strip(),
            target=data.get("target") or None,
            goal_status=str(data.get("goal_status") or "in_progress").strip(),
            thought=str(data.get("thought") or "").strip(),
        )
        if act.action not in ACTIONS:
            errors.append(f"未知动作 {act.action}，已改为 wait")
            act.action, act.target = "wait", None
        if ACTIONS[act.action][1] is None:
            act.target = None
        problem = caps.allows(act.action, act.target) if caps else None
        if problem:
            errors.append(f"{problem}，已改为 wait")
            act.action, act.target = "wait", None
        if act.goal_status not in GOAL_STATUSES:
            errors.append(f"未知 goal_status {act.goal_status}，已改为 in_progress")
            act.goal_status = "in_progress"
        return act, errors


# ---------------- WebSocket 消息 ----------------
# 每条消息是一个 JSON 对象，用 "type" 区分。身体（环境/人物模型）是客户端，大脑是服务端。
#
# 身体 -> 大脑
#   hello      {"type":"hello","version":1,"persona":"wang","scenario":"bank"}   连接后第一条
#   event      {"type":"event","event":{...Event},"state":{...},"audio":"<base64 mp3/wav，可选>"}
#   audio_done {"type":"audio_done","id":3}                             大脑发来的语音播完了
#   bye        {"type":"bye"}
#
# 大脑 -> 身体
#   ready      {"type":"ready","version":1,"scenario":{...},"persona":{...},"actions":[...],"locations":[...]}
#   command    {"type":"command","id":3,"thought":"...","speech":"...","action":"walk_to","target":"counter_1",
#               "goal_status":"in_progress","audio":"<base64 mp3，可选>","audio_seconds":2.4,"latency":3.1}
#   heard      {"type":"heard","text":"ASR 识别结果","original":"原文"}       调试用，身体可以忽略
#   error      {"type":"error","message":"..."}

def event_message(event: Event, state: dict, audio: str | None = None) -> dict:
    msg = {"type": "event", "event": asdict(event), "state": state}
    if audio:
        msg["audio"] = audio
    return msg
