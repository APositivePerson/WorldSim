"""顾客大脑服务（WebSocket 服务端）。

身体（2D 环境、同门的人物模型、公司的仿真平台……）作为客户端连上来，
把听到的声音、看到的事件发过来；大脑决策后把 {说的话 + 语音 + 动作} 发回去。
消息格式见 protocol.py 和 docs/接口文档.md。

单独运行：python brain_server.py [--port 8765] [--no-tts] [--no-asr]
"""
from __future__ import annotations

import argparse
import json
import threading
import time

from websockets.exceptions import ConnectionClosed
from websockets.sync.server import Server, ServerConnection, serve

import config
from agent.brain import CustomerBrain
from agent.action_feedback import ActionFeedback, navigation_context
from perception.context import visual_context
from protocol import ACTIONS, DEFAULT_PORT, PROTOCOL_VERSION, Event, Observation
from scenario import DEFAULT_SCENARIO, Scenario, load_scenario
from voice.audio import audio_duration, b64decode, b64encode
from voice.tts import synthesize

HEARD_TYPES = ("robot_speech", "teller_speech", "broadcast")   # 这些事件带音频时要经过 ASR
MAX_MESSAGE_BYTES = 16 * 1024 * 1024


class BrainSession:
    """一个连接 = 一位顾客。收消息在连接线程里，决策在单独的线程里，互不阻塞。

    scenario：场景（地点、员工、规则），见 scenario.py。
    body_profile / capabilities：身体在 hello 里声明自己能做什么，大脑只会用这些动作和目标。
    """

    def __init__(self, conn: ServerConnection, scenario: Scenario, persona_key: str, use_tts: bool, recognizer,
                 body_profile=None, mode="manual", capabilities=None):
        self.conn = conn
        self.scenario = scenario
        self.persona = scenario.personas[persona_key]
        self.use_tts = use_tts
        self.recognizer = recognizer
        self.body_profile = body_profile
        self.caps = scenario.capabilities(body_profile, capabilities)
        self.brain = CustomerBrain(self.persona, scenario, self.caps, body_profile)
        self.bank_state = {}   # 场景流程状态（号码、叫号柜台等），由身体随事件发来
        self.cond = threading.Condition()
        self.pending: list[Event] = []
        self.state = {"time": 0.0, "location": scenario.start_place(body_profile),
                      "posture": "standing", "current_action": "wait", "navigation": None}
        self.closed = False
        self.thinking = False
        self.cmd_id = 0
        self.send_lock = threading.Lock()
        self.last_command = None
        self.action_feedback = ActionFeedback()
        self.visual_observation = None
        self.staff = None
        if mode == "auto" and body_profile:   # 浏览器身体的自动对话由大脑这边驱动员工；2D 身体自己驱动
            from staff_auto import BrowserStaff
            self.staff = BrowserStaff(self)

        config.LOG_DIR.mkdir(exist_ok=True)
        path = config.LOG_DIR / f"{time.strftime('%Y%m%d_%H%M%S')}_{scenario.id}_{persona_key}_brain.jsonl"
        self.log_file = path.open("w", encoding="utf-8")
        self.log({"kind": "session_start", "scenario": scenario.id, "persona": persona_key,
                  "body_profile": body_profile, "mode": mode, "capabilities": self.caps.to_dict()})
        threading.Thread(target=self._decide_loop, daemon=True).start()

    # ---------- 收发 ----------
    def send(self, msg: dict) -> None:
        try:
            with self.send_lock:
                self.conn.send(json.dumps(msg, ensure_ascii=False))
        except ConnectionClosed:
            pass

    def log(self, record: dict) -> None:
        with self.send_lock:
            if self.log_file.closed:   # 断开后决策线程可能还有最后一条
                return
            self.log_file.write(json.dumps({"t": self.state.get("time"), **record}, ensure_ascii=False) + "\n")
            self.log_file.flush()

    def on_message(self, msg: dict) -> None:
        kind = msg.get("type")
        if kind == "event":
            self._on_event(msg)
        elif kind == "audio_done":
            self.log({"kind": "audio_done", "id": msg.get("id")})
        elif kind == "staff_request" and self.staff:
            self._update_state(msg)
            self.bank_state.update(msg.get("bank") or {})
            command_id = msg.get("command_id")
            if command_id is None or isinstance(command_id, int):
                self.staff.request(command_id)
        elif kind == "action_feedback":
            # 核对命令后保存，不主动唤醒：页面会在语音结束后发业务事件。
            with self.cond:
                accepted, reason = self.action_feedback.accept(msg)
            self.log({"kind": "action_feedback", "id": msg.get("id"),
                      "action": msg.get("action"), "status": msg.get("status"),
                      "message": msg.get("message"), "accepted": accepted, "reason": reason,
                      **({"navigation": navigation_context(msg["navigation"]), "result_reason": msg.get("reason")}
                         if isinstance(msg.get("navigation"), dict) else {})})
            self.send({"type": "feedback_received", "id": msg.get("id"),
                       "accepted": accepted, "reason": reason})
        elif kind == "action_progress":
            # Monitoring does not wake the model or transfer motion authority.
            with self.cond:
                accepted, reason = self.action_feedback.accept_progress(msg)
            self.log({"kind": "action_progress", "id": msg.get("id"), "phase": msg.get("phase"),
                      "seq": msg.get("seq"), "accepted": accepted, "reason": reason,
                      "navigation": navigation_context(msg.get("navigation"))})
        else:
            self.send({"type": "error", "message": f"未知消息类型：{kind}"})

    def _update_state(self, msg):
        state = msg.get("state") or {}
        self.state.update({k: v for k, v in state.items() if k in self.state and k != "navigation"})
        if "navigation" in state:
            self.state["navigation"] = navigation_context(state["navigation"], self.caps.places)

    def _on_event(self, msg: dict) -> None:
        raw = msg.get("event") or {}
        if raw.get("type") in ("action_done", "action_failed") and "command_id" in msg:
            with self.cond:
                accepted = self.action_feedback.accept_event(msg["command_id"], raw.get("type"))
            if not accepted:
                self.log({"kind": "ignored_action_event", "command_id": msg["command_id"]})
                return
        if raw.get("type") == "navigation_available":
            navigation = navigation_context((msg.get("state") or {}).get("navigation"), self.caps.places)
            with self.cond:
                accepted = self.action_feedback.accept_available(msg.get("command_id"), navigation)
            if not accepted:
                self.log({"kind": "ignored_navigation_available", "command_id": msg.get("command_id")})
                return
        ev = Event(type=str(raw.get("type", "")), content=str(raw.get("content", "")),
                   time=float(raw.get("time", 0.0)))
        audio = msg.get("audio")
        if audio and self.recognizer and ev.type in HEARD_TYPES:
            # 顾客是用耳朵听的：有音频就以 ASR 的识别结果为准
            original = ev.content
            t0 = time.time()
            try:
                ev.content = self.recognizer.transcribe_audio_file(b64decode(audio)) or "（没听清对方说了什么）"
            except Exception as e:
                self.send({"type": "error", "message": f"ASR 失败，改用原文：{e}"})
            asr_time = time.time() - t0
            self.send({"type": "heard", "text": ev.content, "original": original, "asr_time": round(asr_time, 3)})
            self.log({"kind": "asr", "original": original, "heard": ev.content, "asr_time": round(asr_time, 3)})
        with self.cond:
            self._update_state(msg)
            self.bank_state.update(msg.get("bank") or {})
            # Fresh evidence belongs to this decision; do not carry an old picture forever.
            self.visual_observation = visual_context(
                msg.get("vision"), self.state["time"], self.cmd_id or None)
            self.pending.append(ev)
            self.cond.notify()
        # 收到的事件也要记下来，否则会话中途结束时分不清是没收到事件还是决策没做完
        self.log({"kind": "event", "event": {"type": ev.type, "content": ev.content, "time": ev.time}})

    def close(self) -> None:
        with self.cond:
            self.closed = True
            pending = len(self.pending)
            self.cond.notify()
        self.log({"kind": "session_closed", "thinking": self.thinking, "pending_events": pending})
        with self.send_lock:
            self.log_file.close()

    # ---------- 决策 ----------
    def _decide_loop(self) -> None:
        while True:
            with self.cond:
                while not self.pending and not self.closed:
                    self.cond.wait()
                if self.closed:
                    return
                # 思考期间新来的事件会攒到下一轮一起处理
                events, self.pending = self.pending, []
                vision = visual_context(self.visual_observation, self.state["time"], self.cmd_id or None)
                self.visual_observation = None
                obs = Observation(events=events, action_results=self.action_feedback.snapshot(),
                                  vision=vision, **self.state)
            self.send({"type": "status", "thinking": True})
            self.thinking = True
            t0 = time.time()
            try:
                act, errors = self.brain.decide(obs)
            except Exception as e:   # 网络、鉴权等错误报给身体，不让服务崩掉
                self.thinking = False
                self.send({"type": "status", "thinking": False})
                self.send({"type": "error", "message": f"LLM 调用失败：{e}"})
                self.log({"kind": "error", "error": str(e), "observation": obs.to_dict()})
                continue

            audio, seconds = None, 0.0
            if self.use_tts and act.speech:
                try:
                    data = synthesize(act.speech, **self.persona["voice"])
                    audio, seconds = b64encode(data), round(audio_duration(data), 2)
                except Exception as e:
                    errors.append(f"TTS 失败：{e}")
            self.cmd_id += 1
            latency = round(time.time() - t0, 2)
            cmd = {"type": "command", "id": self.cmd_id, **act.to_dict(),
                   "audio": audio, "audio_seconds": seconds, "latency": latency, "errors": errors}
            self.last_command = cmd
            # 必须先登记再发送，防止快速反馈先于登记到达。
            with self.cond:
                if self.closed:
                    return
                self.action_feedback.register(cmd)
            self.thinking = False
            self.send({"type": "status", "thinking": False})
            self.send(cmd)
            self.log({"kind": "decision", "id": self.cmd_id, "observation": obs.to_dict(),
                      "action": act.to_dict(), "errors": errors, "latency": latency})


def make_handler(use_tts: bool, recognizer, default_scenario: str = DEFAULT_SCENARIO):
    def handler(conn: ServerConnection) -> None:
        def reply(msg: dict) -> None:
            conn.send(json.dumps(msg, ensure_ascii=False))

        try:
            hello = json.loads(conn.recv(timeout=10))
        except (TimeoutError, ConnectionClosed, json.JSONDecodeError):
            return
        if hello.get("type") != "hello":
            reply({"type": "error", "message": "第一条消息必须是 hello"})
            return
        try:
            scenario = load_scenario(hello.get("scenario") or default_scenario)
        except RuntimeError as e:
            reply({"type": "error", "message": str(e)})
            return
        persona_key = hello.get("persona") or next(iter(scenario.personas))
        if persona_key not in scenario.personas:
            reply({"type": "error", "message": f"场景 {scenario.id} 里没有这个人设：{persona_key}，"
                                               f"可选 {list(scenario.personas)}"})
            return
        try:
            session = BrainSession(conn, scenario, persona_key, use_tts, recognizer, hello.get("body_profile"),
                                   hello.get("mode", "manual"), hello.get("capabilities"))
        except Exception as e:
            reply({"type": "error", "message": f"大脑启动失败：{e}"})
            return

        p, caps = session.persona, session.caps
        session.send({
            "type": "ready", "version": PROTOCOL_VERSION,
            "scenario": {"id": scenario.id, "name": scenario.name, "start": scenario.start_place(session.body_profile),
                         "greeter": scenario.greeter,
                         "staff": {k: {"label": v["label"], "places": v.get("places", [])}
                                   for k, v in scenario.staff.items()}},
            # 只给身体看的公开信息，隐藏信息不发出去
            "persona": {"key": persona_key, "name": p["name"], "age": p["age"], "gender": p["gender"], "goal": p["goal"]},
            # 这一场实际会用到的动作和目标（场景提供的 ∩ 身体声明的）
            "actions": [{"name": a, "description": ACTIONS[a][0],
                         "targets": {"place": caps.places, "look": caps.look_targets}.get(ACTIONS[a][1])}
                        for a in caps.actions],
            "locations": [{"key": k, "description": scenario.places[k]} for k in caps.places],
            "look_targets": [{"key": k, "description": scenario.label(k)} for k in caps.look_targets],
        })
        print(f"[大脑] 身体已连接：{p['name']}")
        try:
            for raw in conn:
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    session.send({"type": "error", "message": "消息不是合法 JSON"})
                    continue
                if msg.get("type") == "bye":
                    break
                session.on_message(msg)
        except ConnectionClosed:
            pass
        finally:
            session.close()
            print(f"[大脑] 身体已断开：{p['name']}")

    return handler


def start_server(host: str = "localhost", port: int = DEFAULT_PORT, use_tts: bool = True,
                 use_asr: bool = True, scenario: str = DEFAULT_SCENARIO) -> Server:
    load_scenario(scenario)   # 场景文件有错时启动就报出来
    recognizer = None
    if use_asr:
        from voice.asr import Recognizer   # 用不到 ASR 时不加载模型
        recognizer = Recognizer()
    return serve(make_handler(use_tts, recognizer, scenario), host, port, max_size=MAX_MESSAGE_BYTES)


def main():
    parser = argparse.ArgumentParser(description="顾客大脑 WebSocket 服务")
    parser.add_argument("--host", default="localhost", help="要让局域网里别的电脑连接，改成 0.0.0.0")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--no-tts", action="store_true", help="不合成顾客语音，只发文字")
    parser.add_argument("--no-asr", action="store_true", help="不做语音识别，直接用事件里的文字")
    parser.add_argument("--scenario", default=DEFAULT_SCENARIO,
                        help="默认场景（scenarios/ 下的文件夹名）；身体也可以在 hello 里指定")
    args = parser.parse_args()
    server = start_server(args.host, args.port, not args.no_tts, not args.no_asr, args.scenario)
    print(f"[大脑] 已启动：ws://{args.host}:{args.port}  默认场景：{args.scenario}  （Ctrl+C 退出）")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
