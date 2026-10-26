"""一键启动：在同一个进程里启动顾客大脑服务 + 2D 身体。

用法：
  python main.py --persona wang                 # 手动：你打字扮演服务机器人
  python main.py --persona wang --mode auto     # 自动：AI 扮演工作人员，你在旁边看
  python main.py --scenario bank --persona li   # 选择场景（scenarios/ 下的文件夹）

也可以分开启动（比如以后身体换成 Unity）：
  python brain_server.py
  python body_2d.py --persona wang
"""
from __future__ import annotations

import argparse
import threading

from brain_server import start_server
from env.body_2d import Body2D
from protocol import DEFAULT_PORT
from scenario import DEFAULT_SCENARIO, SCENARIOS_DIR, load_scenario


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenario", default=DEFAULT_SCENARIO,
                        choices=sorted(p.name for p in SCENARIOS_DIR.iterdir() if (p / "scene.json").exists()))
    parser.add_argument("--persona", default=None, help="人设 key，默认取场景里的第一个")
    parser.add_argument("--mode", default="manual", choices=["manual", "auto"],
                        help="manual：你打字扮演机器人；auto：AI 扮演机器人和柜员")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--no-voice", action="store_true", help="不播放顾客语音，只显示文字")
    parser.add_argument("--no-asr", action="store_true",
                        help="银行端的话直接以文字交给顾客，不经过 语音 -> ASR")
    args = parser.parse_args()
    personas = load_scenario(args.scenario).personas
    persona = args.persona or next(iter(personas))
    if persona not in personas:
        parser.error(f"场景 {args.scenario} 里没有人设 {persona}，可选 {list(personas)}")

    server = start_server("localhost", args.port, use_tts=not args.no_voice, use_asr=not args.no_asr,
                          scenario=args.scenario)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        body = Body2D(persona, args.mode, f"ws://localhost:{args.port}",
                      send_audio=not args.no_asr, play_audio=not args.no_voice, scenario=args.scenario)
        body.run()
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
