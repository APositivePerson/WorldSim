"""语音合成（TTS）与播放。

- synthesize()：用 Edge-TTS 在线合成（免费的微软服务，需要联网）。以后换 TTS 只需替换这个函数。
- AudioPlayer：在后台线程里按顺序播放音频，不会卡住画面，也不会两句叠在一起。
- Speaker：合成 + 播放，给环境里的机器人、柜员用。
"""
from __future__ import annotations

import asyncio
import io
import queue
import threading
import time
from typing import Callable

import edge_tts
import pygame


def synthesize(text: str, voice: str, rate: str = "+0%", pitch: str = "+0Hz") -> bytes:
    """合成一句话，返回 mp3 数据。"""
    async def run() -> bytes:
        comm = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
        data = bytearray()
        async for chunk in comm.stream():
            if chunk["type"] == "audio":
                data += chunk["data"]
        return bytes(data)

    data = asyncio.run(run())
    if not data:
        raise RuntimeError("没有收到音频数据")
    return data


class AudioPlayer:
    def __init__(self, on_error: Callable[[str], None] | None = None):
        self.on_error = on_error or (lambda msg: None)
        self._queue: queue.Queue = queue.Queue()
        self._busy = False
        self._speaking_until = 0.0
        if not pygame.mixer.get_init():
            pygame.mixer.init()
        threading.Thread(target=self._worker, daemon=True).start()

    def play(self, get_audio: Callable[[], bytes], on_start: Callable[[float], None] | None = None,
             on_end: Callable[[bytes | None], None] | None = None) -> None:
        """排队播放。

        get_audio：在后台线程里调用，返回音频数据（可以在里面做合成）。
        on_start(音频秒数)：真正开始播放时调用，方便同步气泡。
        on_end(音频数据)：播放结束时调用（后台线程）；拿不到音频时参数为 None。
        """
        self._queue.put((get_audio, on_start, on_end))

    @property
    def speaking(self) -> bool:
        return self._busy or time.time() < self._speaking_until or not self._queue.empty()

    def _worker(self) -> None:
        while True:
            get_audio, on_start, on_end = self._queue.get()
            self._busy = True
            try:
                audio = get_audio()
                sound = pygame.mixer.Sound(io.BytesIO(audio))
            except Exception as e:  # 断网、服务变动等，只提示，不影响仿真继续
                self.on_error(f"语音合成/播放失败：{e}")
                self._busy = False
                if on_end:
                    self._safe_call(on_end, None)
                continue
            length = sound.get_length()
            self._speaking_until = time.time() + length
            self._busy = False
            sound.play()
            if on_start:
                self._safe_call(on_start, length)
            time.sleep(length)          # 等这句播完再播下一句
            if on_end:
                self._safe_call(on_end, audio)

    def _safe_call(self, fn: Callable, *args) -> None:
        try:
            fn(*args)
        except Exception as e:
            self.on_error(f"语音回调出错：{e}")


class Speaker(AudioPlayer):
    def __init__(self, voice: str, rate: str = "+0%", pitch: str = "+0Hz",
                 on_error: Callable[[str], None] | None = None):
        super().__init__(on_error)
        self.voice, self.rate, self.pitch = voice, rate, pitch

    def say(self, text: str, on_start: Callable[[float], None] | None = None,
            on_end: Callable[[bytes | None], None] | None = None) -> None:
        if text.strip():
            self.play(lambda: synthesize(text, self.voice, self.rate, self.pitch), on_start, on_end)
