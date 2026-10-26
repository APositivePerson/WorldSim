"""从 .env 读取配置。"""
import os
from pathlib import Path

from dotenv import load_dotenv
from proxy_config import normalize_proxy_environment

ROOT = Path(__file__).parent
load_dotenv(ROOT / ".env")
normalize_proxy_environment(os.environ)

GLM_API_KEY = os.getenv("GLM_API_KEY", "")
GLM_BASE_URL = os.getenv("GLM_BASE_URL", "https://open.bigmodel.cn/api/paas/v4/")
GLM_MODEL = os.getenv("GLM_MODEL", "glm-5.3")
# GLM-5.3 强制开启思考；旧模型可设 disabled；留空则不传。
GLM_THINKING = os.getenv("GLM_THINKING", "enabled").strip()
# GLM-5.3 支持 low / high / max；旧模型不支持时请留空。
GLM_REASONING_EFFORT = os.getenv("GLM_REASONING_EFFORT", "low").strip()
# 单次 GLM 调用的超时秒数
GLM_TIMEOUT = float(os.getenv("GLM_TIMEOUT", "60"))

LOG_DIR = ROOT / "logs"

# 视觉验证独立配置，不沿用文本模型的 reasoning_effort。
VLM_MODEL = os.getenv("VLM_MODEL", "glm-4.6v")
VLM_BASE_URL = os.getenv("VLM_BASE_URL", GLM_BASE_URL)
VLM_API_KEY = os.getenv("VLM_API_KEY") or GLM_API_KEY
VLM_TIMEOUT = float(os.getenv("VLM_TIMEOUT", "60"))
