from __future__ import annotations

import base64
import ctypes
import json
import os
import secrets
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def atomic_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def protect(value: str, decrypt: bool = False) -> str:
    """Windows user-bound DPAPI. Never persist plaintext API keys on other OSes."""
    if os.name != "nt":
        raise ValueError("此系统请使用 DEEPSEEK_API_KEY 环境变量")

    class Blob(ctypes.Structure):
        _fields_ = [("size", ctypes.c_ulong), ("data", ctypes.POINTER(ctypes.c_char))]

    raw = base64.b64decode(value) if decrypt else value.encode("utf-8")
    buffer = ctypes.create_string_buffer(raw)
    source = Blob(len(raw), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char)))
    output = Blob()
    method = ctypes.windll.crypt32.CryptUnprotectData if decrypt else ctypes.windll.crypt32.CryptProtectData
    if not method(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(output)):
        raise ValueError("Windows 无法读取或保护 API Key")
    try:
        result = ctypes.string_at(output.data, output.size)
        return result.decode("utf-8") if decrypt else base64.b64encode(result).decode("ascii")
    finally:
        ctypes.windll.kernel32.LocalFree(output.data)


class Settings:
    def __init__(self, root: Path | None = None):
        self.root = root or Path(os.getenv("SCUT_ASSISTANT_HOME", str(ROOT / ".local")))
        self.root.mkdir(parents=True, exist_ok=True)
        self.path = self.root / "settings.json"
        pot = Path(os.getenv("APPDATA", str(Path.home()))) / "PotPlayerMini64"
        engine = pot / "Engine" / "Faster-Whisper-XXL"
        self.data = {
            "token": secrets.token_urlsafe(32),
            "engine": "resident",
            "engine_path": str(engine / "faster-whisper-xxl.exe"),
            "ffmpeg_path": str(engine / "ffmpeg.exe"),
            "model_path": str(pot / "Model" / "faster-whisper-large-v3-turbo"),
            "device": "cuda", "compute_type": "int8_float16", "language": "auto",
            "hotwords": "", "deepseek_model": "deepseek-v4-flash",
            "deepseek_key_encrypted": "", "analysis_window": 35,
            "media_hosts": [], "retain_audio": False,
        }
        if self.path.exists():
            self.data.update(json.loads(self.path.read_text(encoding="utf-8")))
        else:
            self.save()
        (self.root / "connection.txt").write_text(
            "本地服务：http://127.0.0.1:8765\n扩展连接口令（仅保存在本机）：\n" + self.data["token"] + "\n",
            encoding="utf-8",
        )

    def save(self):
        atomic_json(self.path, self.data)

    def key(self) -> str:
        if key := os.getenv("DEEPSEEK_API_KEY", "").strip():
            return key
        encrypted = self.data.get("deepseek_key_encrypted")
        return protect(encrypted, True) if encrypted else ""

    def public(self) -> dict:
        result = {k: v for k, v in self.data.items() if k not in {"token", "deepseek_key_encrypted"}}
        result["deepseek_configured"] = bool(self.key())
        result["output_path"] = str(self.root / "sessions")
        return result

    def update(self, patch: dict):
        allowed = set(self.public()) - {"deepseek_configured", "output_path"}
        for k, v in patch.items():
            if k in allowed:
                self.data[k] = v
        if patch.get("deepseek_key"):
            self.data["deepseek_key_encrypted"] = protect(patch["deepseek_key"].strip())
        if patch.get("clear_deepseek_key"):
            self.data["deepseek_key_encrypted"] = ""
        self.save()
