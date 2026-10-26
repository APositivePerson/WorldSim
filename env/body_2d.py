"""2D 身体：pygame 画面 + 简易环境，作为 WebSocket 客户端连接顾客大脑。场景内容来自场景文件。

这个文件就是"身体"的一个参考实现。同门的人物模型（Unity 等）要做的事和这里一样：
连上大脑 -> 把事件发过去 -> 收到 command 后播放语音、执行动作 -> 动作完成后回报 action_done。

两种模式：
- manual（默认）：你打字扮演服务机器人（场景里的迎宾员工）
- auto：员工 Agent（场景里的全部工作人员）自动和顾客对话，你在旁边看

单独运行（需要先启动 brain_server.py）：python body_2d.py --persona wang --mode auto
"""
from __future__ import annotations

import json
import os
import queue
import threading
import time

os.environ.setdefault("SDL_IME_SHOW_UI", "1")   # 显示系统输入法的候选词窗口；必须在 import pygame 之前

import pygame
from websockets.exceptions import ConnectionClosed
from websockets.sync.client import connect

import config
from env.renderer import MAP_H, MAP_W, WIN_H, WIN_W, Renderer
from env.world import World2D
from protocol import DEFAULT_PORT, PROTOCOL_VERSION, AgentAction, Event, event_message
from scenario import DEFAULT_SCENARIO, load_scenario
from voice.audio import b64decode, b64encode
from voice.tts import AudioPlayer, Speaker, synthesize

IDLE_NUDGE_SECONDS = 25      # 这么久没有任何动静，就提醒顾客"时间过去了"
STAFF_QUIET_SECONDS = 1.0    # 顾客说完、动作停下来后，银行员工等这么久再决定要不要接话
MAX_STAFF_TURNS = 60         # 自动模式下银行员工最多说几次，防止死循环、控制 GLM 费用


class Body2D:
    def __init__(self, persona_key: str, mode: str = "manual", url: str = f"ws://localhost:{DEFAULT_PORT}",
                 send_audio: bool = True, play_audio: bool = True, scenario: str = DEFAULT_SCENARIO):
        self.mode = mode
        self.send_audio = send_audio
        self.scenario = sc = load_scenario(scenario)
        self.world = World2D(sc)
        self.inbox: queue.Queue = queue.Queue()      # 所有后台线程 -> 主线程的消息
        self.conn = connect(url, max_size=16 * 1024 * 1024)
        # 2D 环境只能去写了 pos2d 的地点，在 hello 里告诉大脑
        caps = {"places": list(self.world.positions), "look_targets": list(self.world.look_positions)}
        self.conn.send(json.dumps({"type": "hello", "version": PROTOCOL_VERSION, "persona": persona_key,
                                   "scenario": sc.id, "capabilities": caps}))
        ready = json.loads(self.conn.recv(timeout=30))
        if ready.get("type") != "ready":
            raise RuntimeError(f"大脑拒绝连接：{ready.get('message', ready)}")
        self.persona = ready["persona"]
        threading.Thread(target=self._recv_loop, daemon=True).start()

        config.LOG_DIR.mkdir(exist_ok=True)
        path = config.LOG_DIR / f"{time.strftime('%Y%m%d_%H%M%S')}_{sc.id}_{persona_key}_{mode}.jsonl"
        self.log_file = path.open("w", encoding="utf-8")
        self.log_name = path.name

        on_err = lambda msg: self.inbox.put(("error", msg))
        self.customer_player = AudioPlayer(on_err) if play_audio else None
        self.speakers = {k: Speaker(**sc.staff_voice(k), on_error=on_err) for k in sc.staff}
        self.staff = None
        if mode == "auto":
            from agent.staff import StaffAgent
            self.staff = StaffAgent(sc, caps=sc.capabilities(None, caps))
        self.staff_thinking = False
        self.staff_notes: list[str] = []
        self.staff_turns = 0
        self.staff_due = False          # 有需要员工考虑回应的新情况
        self.quiet_since = 0.0
        self.customer_thinking = False
        self.voices_busy = 0            # 正在合成/播放的银行端语音条数
        self.last_activity = 0.0

    # ---------- 网络 ----------
    def _recv_loop(self) -> None:
        try:
            for raw in self.conn:
                self.inbox.put(("brain", json.loads(raw)))
        except ConnectionClosed:
            pass
        self.inbox.put(("closed", None))

    def _send(self, msg: dict) -> None:
        try:
            self.conn.send(json.dumps(msg, ensure_ascii=False))
        except ConnectionClosed:
            self.inbox.put(("error", "和大脑的连接断开了"))

    def flush_events(self) -> None:
        """把环境里新产生的事件发给大脑。"""
        for ev in self.world.drain_events():
            if ev.type in ("action_done", "action_failed", "time_passed"):
                self.ui.add_log("event", f"  [{ev.type}] {ev.content}")
            self._send(event_message(ev, self.world.state()))

    def log(self, record: dict) -> None:
        self.log_file.write(json.dumps({"t": round(self.world.time, 1), **record}, ensure_ascii=False) + "\n")
        self.log_file.flush()

    # ---------- 员工这边说话 ----------
    def bank_says(self, who: str, text: str) -> None:
        """who：场景里的员工 key。先播放语音，播完后把"声音 + 原文"发给大脑，由大脑的 ASR 去听。"""
        sc, loc = self.scenario, self.world.location
        speaker = self.speakers[who]
        # 迎宾（服务机器人）说的话是 robot_speech，其他工作人员是 teller_speech
        event_type = "robot_speech" if who == sc.greeter else "teller_speech"
        bubble = who if who == sc.greeter else f"{who}@{loc}"
        name = sc.staff_label(who, loc)
        self.voices_busy += 1
        self.ui.add_log("robot" if who == sc.greeter else "teller", f"{name}：{text}")
        self.log({"kind": event_type, "text": text})
        speaker.say(
            text,
            on_start=lambda length: self.inbox.put(("bubble", (bubble, text, length))),
            on_end=lambda audio: self.inbox.put(("bank_spoke", (event_type, text, audio))))

    def _staff_think(self, observation: dict) -> None:
        try:
            self.inbox.put(("staff", self.staff.decide(observation)))
        except Exception as e:
            self.inbox.put(("staff_error", str(e)))

    # ---------- 主循环 ----------
    def run(self) -> None:
        pygame.init()
        screen = pygame.display.set_mode((WIN_W, WIN_H))
        mode_name = "自动对话" if self.mode == "auto" else "手动（你扮演机器人）"
        pygame.display.set_caption(f"顾客仿真 - {self.scenario.name} - {self.persona['name']} - {mode_name}")
        pygame.key.start_text_input()
        pygame.key.set_text_input_rect(pygame.Rect(10, MAP_H + 8, MAP_W - 20, 28))
        clock = pygame.time.Clock()
        self.ui = ui = Renderer(screen)
        others = [k for k in self.scenario.staff if k != self.scenario.greeter]
        other_hint = "".join(f"/{k} 文本 = {self.scenario.staff[k]['label']}说话；" for k in others)
        ui.hint = ("自动模式：工作人员由 AI 扮演。/sys 文本 = 旁白；空格 暂停/继续；Esc 退出"
                   if self.mode == "auto" else
                   f"直接打字回车 = {self.scenario.staff[self.scenario.greeter]['label']}说话（走语音）；"
                   f"{other_hint}/sys 文本 = 旁白；Esc 退出")
        ui.add_log("sys", f"顾客：{self.persona['name']}（{self.persona['age']}岁）  目的：{self.persona['goal']}")
        ui.add_log("sys", f"日志：{self.log_name}")
        input_text, composing = "", ""
        paused = False
        running = True
        self.flush_events()   # scene_start

        while running:
            dt = clock.tick(30) / 1000.0
            for ev in pygame.event.get():
                if ev.type == pygame.QUIT:
                    running = False
                elif ev.type == pygame.MOUSEWHEEL:
                    ui.scroll = max(0, ui.scroll + ev.y * 3)
                elif ev.type == pygame.TEXTEDITING:
                    composing = ev.text
                elif ev.type == pygame.TEXTINPUT:
                    if self.mode == "auto" and ev.text == " " and not input_text:
                        paused = not paused
                        ui.add_log("sys", "已暂停（顾客和员工不再开始新一轮思考）" if paused else "继续")
                        continue
                    input_text += ev.text
                    composing = ""
                elif ev.type == pygame.KEYDOWN:
                    if ev.key == pygame.K_ESCAPE:
                        running = False
                    elif ev.key == pygame.K_BACKSPACE and not composing:
                        input_text = input_text[:-1]
                    elif ev.key in (pygame.K_RETURN, pygame.K_KP_ENTER) and not composing:
                        self._handle_input(input_text.strip())
                        input_text = ""

            self.world.update(dt)
            self._handle_inbox()
            self.flush_events()
            if not paused:
                self._maybe_nudge(bool(input_text or composing))
                if self.staff:
                    self._maybe_staff_turn()
            if not self.staff:
                self.world.drain_bank_notes()   # 手动模式没人看这些，丢掉

            thinking = self.customer_thinking
            ui.draw(self.world, input_text, composing, thinking, self.persona["name"])
            pygame.display.flip()

        try:
            self.conn.send(json.dumps({"type": "bye"}))
            self.conn.close()
        except ConnectionClosed:
            pass
        self.log_file.close()
        pygame.quit()

    def _handle_input(self, text: str) -> None:
        if not text:
            return
        if text.startswith("/sys "):
            self.world.add_event("system_message", text[5:])
            self.ui.add_log("sys", f"[旁白，不走语音] {text[5:]}")
            self.log({"kind": "system_message", "text": text[5:]})
            self.staff_notes.append(f"旁白：{text[5:]}")
        elif text.startswith("/") and text[1:].split(" ", 1)[0] in self.scenario.staff:
            who, _, said = text[1:].partition(" ")
            if self.scenario.fix_speaker(who, self.world.location) != who:
                self.ui.add_log("error", f"顾客不在{self.scenario.staff[who]['label']}的岗位前，听不到")
                return
            if said.strip():
                self.bank_says(who, said.strip())
        elif self.mode == "manual":
            self.bank_says(self.scenario.greeter, text)
        else:
            self.ui.add_log("error", "自动模式下不能直接说话，可以用 /sys 加旁白")

    def _handle_inbox(self) -> None:
        ui, world = self.ui, self.world
        while not self.inbox.empty():
            kind, payload = self.inbox.get()
            if kind == "brain":
                self._on_brain(payload)
            elif kind == "bubble":
                who, text, length = payload
                ui.say(who, text, world.time, duration=length)
            elif kind == "bank_spoke":
                event_type, text, audio = payload
                self.voices_busy -= 1
                ev = Event(event_type, text, round(world.time, 1))
                encoded = b64encode(audio) if (audio and self.send_audio) else None
                self._send(event_message(ev, world.state(), encoded))
                self.last_activity = world.time
            elif kind == "staff":
                speaker, speech, thought = payload
                self.staff_thinking = False
                self.quiet_since = world.time
                if thought:
                    ui.add_log("thought", f"（员工想：{thought}）")
                if speaker != "none":
                    self.staff_turns += 1
                    self.bank_says(speaker, speech)
            elif kind == "staff_error":
                self.staff_thinking = False
                ui.add_log("error", f"员工 Agent 调用失败：{payload}")
            elif kind == "error":
                ui.add_log("error", payload)
                self.log({"kind": "error", "error": payload})
            elif kind == "closed":
                ui.add_log("error", "大脑断开了连接")

    def _on_brain(self, msg: dict) -> None:
        ui, world = self.ui, self.world
        kind = msg.get("type")
        if kind == "status":
            self.customer_thinking = bool(msg.get("thinking"))
        elif kind == "heard":
            mark = "" if msg["text"] == msg["original"] else "  ≠ 原文"
            ui.add_log("event", f"  [顾客听到] {msg['text']}   (ASR {msg.get('asr_time', 0):.2f}s){mark}")
        elif kind == "error":
            ui.add_log("error", msg.get("message", ""))
        elif kind == "command":
            self.last_activity = world.time
            act = AgentAction(speech=msg.get("speech", ""), action=msg.get("action", "wait"),
                              target=msg.get("target"), goal_status=msg.get("goal_status", "in_progress"),
                              thought=msg.get("thought", ""))
            for e in msg.get("errors") or []:
                ui.add_log("error", e)
            if act.thought:
                ui.add_log("thought", f"（想：{act.thought}）")
            if act.speech:
                ui.add_log("customer", f"{self.persona['name']}：{act.speech}")
                self.staff_notes.append(f"顾客说：{act.speech}")
                self.staff_due = True
                self._play_customer(msg, act.speech)
            if act.action != "wait":
                tgt = f" → {self.scenario.label(act.target)}" if act.target else ""
                ui.add_log("event", f"  动作：{act.action}{tgt}   ({msg.get('latency', 0):.1f}s)")
            if act.goal_status != "in_progress":
                ui.add_log("sys", f"顾客结束：{act.goal_status}")
            world.apply(act)
            self.log({"kind": "command", **{k: v for k, v in msg.items() if k != "audio"}})

    def _play_customer(self, msg: dict, speech: str) -> None:
        cid, audio = msg.get("id"), msg.get("audio")
        if not self.customer_player:
            self.ui.say("customer", speech, self.world.time)
            return
        self.customer_player.play(
            # 大脑没发音频（比如关了 TTS）时，身体自己合成
            (lambda: b64decode(audio)) if audio else (lambda: synthesize(speech, "zh-CN-XiaoxiaoNeural")),
            on_start=lambda length: self.inbox.put(("bubble", ("customer", speech, length))),
            on_end=lambda _: self._send({"type": "audio_done", "id": cid}))

    def _busy(self) -> bool:
        """有人在说话或在思考。"""
        customer_speaking = self.customer_player and self.customer_player.speaking
        return bool(self.customer_thinking or self.staff_thinking or self.voices_busy or customer_speaking)

    def _maybe_nudge(self, typing: bool) -> None:
        world = self.world
        if world.finished:
            return
        if typing or self._busy() or world.walk_target or world.current.action != "wait":
            self.last_activity = world.time
        elif world.time - self.last_activity > IDLE_NUDGE_SECONDS:
            world.add_event("time_passed", f"又过去了 {int(world.time - self.last_activity)} 秒，期间没有新的动静。")
            self.staff_due = True
            self.last_activity = world.time

    def _maybe_staff_turn(self) -> None:
        world = self.world
        for text, needs_reply in world.drain_bank_notes():
            self.staff_notes.append(text)
            self.staff_due = self.staff_due or needs_reply
        if self._busy() or world.walk_target:
            self.quiet_since = world.time
            return
        if not self.staff_due or world.time - self.quiet_since < STAFF_QUIET_SECONDS:
            return
        if self.staff_turns >= MAX_STAFF_TURNS:
            if self.staff_turns == MAX_STAFF_TURNS:
                self.ui.add_log("sys", f"员工已说了 {MAX_STAFF_TURNS} 次，自动对话停止（防止费用失控）")
                self.staff_turns += 1
            return
        if world.finished and world.location in ("exit", "moving"):
            return
        notes, self.staff_notes = self.staff_notes, []
        self.staff_due = False
        self.staff_thinking = True
        obs = {"time": round(world.time, 1),
               "customer": {"location": world.state()["location"], "posture": world.posture,
                            "ticket": world.ticket_no, "leaving": world.finished},
               "recent": notes}
        threading.Thread(target=self._staff_think, args=(obs,), daemon=True).start()
