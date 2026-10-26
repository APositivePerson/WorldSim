"""托管银行场景和项目内人物模块：python body_3d.py。"""
import argparse
import json
import mimetypes
import subprocess
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
VISION_LOCK = threading.Lock()


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        path = urlsplit(self.path).path
        if path.endswith(("/", ".html", ".js", ".mjs")):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def reply_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if urlsplit(self.path).path != "/api/vision":
            self.reply_json(404, {"error": "未知接口"})
            return
        # Local browser endpoint: reject cross-origin requests that could spend API quota.
        host = self.headers.get("Host", "")
        if (host.split(":")[0] not in ("localhost", "127.0.0.1")
                or self.headers.get("Origin") not in (None, "http://" + host)
                or self.headers.get("Content-Type", "").split(";")[0] != "application/json"):
            self.reply_json(403, {"error": "只允许本地页面的 JSON 请求"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 4_100_000:
                raise ValueError("截图请求大小无效")
            self.connection.settimeout(15)
            payload = json.loads(self.rfile.read(size))
            from perception.vision import validate_request, analyze
            validate_request(payload)
        except (ValueError, TimeoutError):
            self.reply_json(400, {"error": "截图请求无效，请重新截图（最多两张 JPEG）"})
            return
        if not VISION_LOCK.acquire(blocking=False):
            self.reply_json(429, {"error": "已有视觉检查正在进行，请稍后重试"})
            return
        try:
            result = analyze(payload)
        except Exception as exc:
            # Provider errors may contain request details; never expose them to the page.
            self.reply_json(502, {"error": f"视觉检查失败（{type(exc).__name__}），请检查密钥、模型权限和网络后重试"})
        else:
            self.reply_json(200, result)
        finally:
            VISION_LOCK.release()

    def __init__(self, *args, human_dist, scan_file=None, **kwargs):
        self.human_dist = human_dist
        self.scan_file = scan_file
        super().__init__(*args, directory=str(ROOT / "web"), **kwargs)

    def do_GET(self):
        if urlsplit(self.path).path == "/human/models/local-scan-status.json":
            body = json.dumps({"available": bool(self.scan_file and self.scan_file.is_file())}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def translate_path(self, path):
        path = unquote(urlsplit(path).path)
        if path == "/human/local-scans/eric.glb":
            return str(self.scan_file if self.scan_file and self.scan_file.is_file() else ROOT / "web" / "__not_found__")
        root = self.human_dist if path.startswith("/human/") else ROOT / "web"
        relative = path[len("/human/"):] if path.startswith("/human/") else path.lstrip("/")
        target = (root / relative).resolve()
        if not target.is_relative_to(root.resolve()):
            return str(ROOT / "web" / "__not_found__")
        return str(target)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--human-dist", type=Path,
                        default=ROOT / "character" / "public",
                        help="人物资产根目录（含 models/），默认为项目内 character/public/")
    parser.add_argument("--scan-file", type=Path,
                        default=ROOT / "character" / "artifacts/scanned-private/runtime/eric.glb",
                        help="可选的本地扫描 GLB，只开放此文件，不复制进构建目录")
    parser.add_argument("--no-scan", action="store_true", help="只使用程序人物")
    args = parser.parse_args()
    if not (args.human_dist / "models/human-neuromuscular.xml").is_file():
        parser.error("没有找到 models/human-neuromuscular.xml，请同步最新人物模块或检查 --human-dist 资产目录")
    print("检查人物与银行场景更新…", flush=True)
    try:
        subprocess.run(["node", str(ROOT / "scripts/build_bank_scene.mjs"), "--if-needed",
                        "--human-assets", str(args.human_dist.resolve())], check=True, cwd=ROOT)
    except (OSError, subprocess.CalledProcessError) as exc:
        parser.error(f"银行场景构建失败：请在本项目根目录运行 npm install。{exc}")
    mimetypes.add_type("application/wasm", ".wasm")
    mimetypes.add_type("text/javascript", ".mjs")
    mimetypes.add_type("model/gltf-binary", ".glb")
    server = ThreadingHTTPServer(("127.0.0.1", args.port),
                                partial(Handler, human_dist=args.human_dist.resolve(),
                                        scan_file=None if args.no_scan else args.scan_file.resolve()))
    print(f"3D 联调页面：http://127.0.0.1:{server.server_port} （Ctrl+C 退出）", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
