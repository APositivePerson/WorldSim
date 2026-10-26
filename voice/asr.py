"""语音识别（ASR）：SenseVoice-Small（int8），用 sherpa-onnx 在 CPU 上运行，不需要显卡和网络。

模型放在 models/sensevoice/，下载方法见 README。
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import sherpa_onnx

import config
from voice.audio import SAMPLE_RATE, decode_audio

MODEL_DIR = config.ROOT / "models" / "sensevoice"


class Recognizer:
    def __init__(self, model_dir: Path = MODEL_DIR, num_threads: int = 4):
        model, tokens = model_dir / "model.int8.onnx", model_dir / "tokens.txt"
        if not model.exists() or not tokens.exists():
            raise RuntimeError(f"没有找到 ASR 模型：{model_dir}，请按 README 下载；或者加 --no-asr 跳过语音识别")
        self._rec = sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=str(model), tokens=str(tokens), language="zh", use_itn=True, num_threads=num_threads)

    def transcribe(self, samples: np.ndarray, sample_rate: int = SAMPLE_RATE) -> str:
        """samples：单声道 float32，范围 [-1, 1]。"""
        stream = self._rec.create_stream()
        stream.accept_waveform(sample_rate, samples)
        self._rec.decode_stream(stream)
        return stream.result.text.strip()

    def transcribe_audio_file(self, data: bytes) -> str:
        """识别 mp3/wav 等编码后的音频数据。"""
        return self.transcribe(decode_audio(data))
