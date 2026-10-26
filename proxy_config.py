"""兼容桌面代理软件导出的 SOCKS 地址。"""
from collections.abc import MutableMapping


def normalize_proxy_environment(environ: MutableMapping[str, str]) -> None:
    """HTTPX 使用 socks5://；保留代理主机、端口、认证和 NO_PROXY。"""
    for name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
                 "http_proxy", "https_proxy", "all_proxy"):
        value = environ.get(name, "")
        if value[:8].lower() == "socks://":
            environ[name] = "socks5://" + value[8:]
