"""GLM 调用的公共部分，顾客大脑和银行员工 Agent 共用。"""
from __future__ import annotations

import json
import re

from openai import OpenAI

import config


def make_client() -> OpenAI:
    if not config.GLM_API_KEY:
        raise RuntimeError("没有找到 GLM_API_KEY，请先在 .env 里填写（参考 .env.example）")
    # SDK 默认超时 10 分钟，卡住时整场对话会停在原地却没有任何报错；超时后会报错并在界面上显示
    return OpenAI(api_key=config.GLM_API_KEY, base_url=config.GLM_BASE_URL,
                  timeout=config.GLM_TIMEOUT, max_retries=1)


def chat_json(client: OpenAI, messages: list[dict], temperature: float = 0.8,
              model: str = config.GLM_MODEL) -> str:
    """调用一次 GLM，要求输出 JSON，返回原始文本。"""
    extra_body = {}
    if config.GLM_THINKING:
        extra_body["thinking"] = {"type": config.GLM_THINKING}
    if config.GLM_REASONING_EFFORT:
        extra_body["reasoning_effort"] = config.GLM_REASONING_EFFORT
    resp = client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=temperature,
        response_format={"type": "json_object"},
        extra_body=extra_body or None,
    )
    return resp.choices[0].message.content or ""


def parse_json(text: str) -> dict:
    """容错地从 LLM 输出中取出 JSON 对象。"""
    text = text.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    if fenced:
        text = fenced.group(1)
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError(f"LLM 输出里没有 JSON：{text[:200]}")
    return json.loads(text[start:end + 1])
