"""浏览器（3D 身体）自动对话里的员工轮次。浏览器播放完上一句之前，不会发起下一次模型调用。

员工角色、业务规定和这一场的补充说明都来自场景文件；2D 身体用的也是同一个 StaffAgent。
"""
import threading

from agent.staff import StaffAgent
from voice.audio import b64encode
from voice.tts import synthesize

MAX_STAFF_TURNS = 20


class BrowserStaff:
    def __init__(self, session):
        self.session = session
        self.scenario = session.scenario
        self.agent = StaffAgent(self.scenario, session.body_profile, session.caps)
        self.lock = threading.Lock()
        self.busy = False
        self.seen = set()
        self.turns = 0

    def request(self, command_id):
        s = self.session
        with self.lock:
            if s.closed or self.busy or command_id in self.seen:
                return
            command = s.last_command
            # 开场只能在顾客还没有任何指令时发起；之后必须对应最新一条顾客指令，不接受客户端编的对话
            expected = command["id"] if command else None
            if command_id != expected:
                s.send({"type": "error", "message": "自动对话轮次不匹配，请重新开始"})
                return
            if command and command.get("goal_status") != "in_progress":
                return
            self.seen.add(command_id)
            if self.turns >= MAX_STAFF_TURNS:
                s.send({"type": "auto_finished", "message": f"员工已达到 {MAX_STAFF_TURNS} 轮上限"})
                return
            self.busy = True
            self.turns += 1
            turn = self.turns
        s.send({"type": "staff_status", "thinking": True})
        threading.Thread(target=self._run, args=(command, turn), daemon=True).start()

    def _observation(self, command):
        s = self.session
        location = s.state.get("location") or self.scenario.start_place(s.body_profile)
        if command:
            recent = [f"顾客说：{command['speech']}"] if command.get("speech") else []
            recent.append(f"顾客动作：{command['action']}")
        else:
            recent = [f"一位顾客出现在{self.scenario.label(location)}，请主动迎接。"]
        bank = getattr(s, "bank_state", {})
        navigation = s.state.get("navigation")
        tracker = getattr(s, 'action_feedback', None)
        results = tracker.snapshot() if tracker else []
        if results and results[-1]["action"] == "walk_to":
            outcome = results[-1]
            recent.append(f"实际行走结果：{outcome['status']}；{outcome.get('message', '')}")
        return {"time": s.state["time"], "customer": {
            "location": location, "posture": s.state.get("posture", "standing"),
            "ticket": bank.get("ticket"), "called_counter": bank.get("called_counter"),
            "leaving": False}, "recent": recent, "navigation": navigation}

    def _run(self, command, turn):
        s = self.session
        try:
            observation = self._observation(command)
            speaker, speech, thought = self.agent.decide(observation)
            if s.closed:
                with self.lock:
                    self.busy = False
                return
            errors, audio = [], None
            if speaker != "none" and speech and s.use_tts:
                try:
                    audio = b64encode(synthesize(speech, **self.scenario.staff_voice(speaker)))
                except Exception as exc:
                    errors.append(f"员工 TTS 失败，使用文字：{exc}")
            message = {"type": "staff_command", "id": f"staff-{turn}", "speaker": speaker,
                       "label": self.scenario.staff_label(speaker, observation["customer"]["location"]),
                       "speech": speech, "audio": audio, "errors": errors, "turn": turn}
            s.log({"kind": "staff_decision", "id": message["id"], "speech": speech,
                   "speaker": speaker, "thought": thought, "errors": errors})
            # 先清 busy 再发消息：没有语音时浏览器可能立刻发下一条 staff_request
            with self.lock:
                self.busy = False
            if not s.closed:
                s.send({"type": "staff_status", "thinking": False})
                s.send(message)
        except Exception as exc:
            with self.lock:
                self.busy = False
            if not s.closed:
                s.log({"kind": "error", "error": str(exc), "source": "staff"})
                s.send({"type": "staff_status", "thinking": False})
                s.send({"type": "auto_finished", "message": f"员工调用失败：{exc}；请结束后重试"})
