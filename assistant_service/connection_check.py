from __future__ import annotations

import hashlib
import time

import httpx


def identity(settings):
    return hashlib.sha256((settings.key() + "\0" + settings.data["deepseek_model"]).encode()).hexdigest()


def check(settings, transport=None):
    if not settings.key():
        return {"ok": False, "message": "尚未保存 Key", "checked_at": time.time()}
    try:
        with httpx.Client(timeout=12, trust_env=False, transport=transport, follow_redirects=False) as client:
            response = client.get("https://api.deepseek.com/models", headers={"Authorization": "Bearer " + settings.key()})
        if response.status_code != 200:
            message = {401: "Key 认证失败，请替换密钥", 403: "账户没有访问权限", 429: "请求频率受限，请稍后重试"}.get(response.status_code, f"DeepSeek HTTP {response.status_code}，请稍后重试")
            return {"ok": False, "message": message, "checked_at": time.time()}
        available = settings.data["deepseek_model"] in {m["id"] for m in response.json()["data"]}
        return {"ok": available, "message": "Key 认证通过，当前模型可用" if available else "Key 认证通过，但当前模型不在可用列表中", "checked_at": time.time()}
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return {"ok": False, "message": "无法完成连接检测，请检查网络后重试", "checked_at": time.time()}
