"""Run one real GLM-4.6V check on local JPEG captures; uses configured API quota."""
import argparse
import base64
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from perception.vision import analyze


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("images", nargs="+", type=Path, help="One image or before/after JPEGs")
    parser.add_argument("--view", choices=["person", "observer"], default="observer")
    args = parser.parse_args()
    if not 1 <= len(args.images) <= 2:
        parser.error("Provide one or two JPEGs")
    frames = [{"image": "data:image/jpeg;base64," + base64.b64encode(p.read_bytes()).decode(),
               "view": args.view, "time": i} for i, p in enumerate(args.images)]
    try:
        result = analyze({"frames": frames})
    except Exception as exc:
        print(json.dumps({"error_type": type(exc).__name__,
                          "status_code": getattr(exc, "status_code", None)}))
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
