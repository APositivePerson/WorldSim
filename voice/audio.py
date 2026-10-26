"""音频解码等公共工具。"""
from __future__ import annotations

import base64
import io

import av
import numpy as np

SAMPLE_RATE = 16000


def decode_audio(data: bytes) -> np.ndarray:
    """把任意格式（mp3/wav/…）的音频解码成 16kHz 单声道 float32。"""
    container = av.open(io.BytesIO(data))
    resampler = av.AudioResampler(format="flt", layout="mono", rate=SAMPLE_RATE)
    frames = [f.to_ndarray().reshape(-1) for frame in container.decode(audio=0) for f in resampler.resample(frame)]
    frames += [f.to_ndarray().reshape(-1) for f in resampler.resample(None)]   # 取出重采样器里剩下的数据
    return np.concatenate(frames) if frames else np.zeros(0, dtype=np.float32)


def audio_duration(data: bytes) -> float:
    return len(decode_audio(data)) / SAMPLE_RATE


def b64encode(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def b64decode(text: str) -> bytes:
    return base64.b64decode(text)
