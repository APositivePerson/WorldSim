"""单独启动 2D 身体，连接已经在运行的 brain_server.py。"""
from __future__ import annotations

import argparse

from env.body_2d import Body2D
from protocol import DEFAULT_PORT
from scenario import DEFAULT_SCENARIO

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenario", default=DEFAULT_SCENARIO)
    parser.add_argument("--persona", default="wang")
    parser.add_argument("--mode", default="manual", choices=["manual", "auto"])
    parser.add_argument("--url", default=f"ws://localhost:{DEFAULT_PORT}")
    parser.add_argument("--no-voice", action="store_true")
    parser.add_argument("--no-asr", action="store_true")
    args = parser.parse_args()
    Body2D(args.persona, args.mode, args.url, send_audio=not args.no_asr, play_audio=not args.no_voice,
           scenario=args.scenario).run()
