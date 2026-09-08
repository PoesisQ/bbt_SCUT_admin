from __future__ import annotations

import base64
import ctypes
import json
import os
import secrets
import threading
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
    def __init__(self, root: Path | None = None, *, vault_root: Path | None = None):
        self.lock = threading.RLock()
        # Explicit roots are isolated (tests/portable installations); normal launches
        # share a Windows-user vault across checkouts and application upgrades.
        self.vault = (vault_root or (root / "private" if root is not None else
                      Path(os.getenv("LOCALAPPDATA", str(Path.home()))) / "SCUTClassroomAssistant")) / "credentials.json"
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
        self._migrate_key()
        (self.root / "connection.txt").write_text(
            "本地服务：http://127.0.0.1:8765\n扩展连接口令（仅保存在本机）：\n" + self.data["token"] + "\n",
            encoding="utf-8",
        )

    def save(self):
        with self.lock:
            atomic_json(self.path, self.data)

    def _migrate_key(self):
        encrypted = self.data.get("deepseek_key_encrypted")
        if not encrypted:
            return
        try:
            if not self.vault.exists():
                protect(encrypted, True)  # Verify before moving the only saved credential.
                atomic_json(self.vault, {"deepseek_key_encrypted": encrypted})
            saved = json.loads(self.vault.read_text(encoding="utf-8"))
            if saved.get("deepseek_key_encrypted"):
                protect(saved["deepseek_key_encrypted"], True)
            # An explicitly cleared vault also takes precedence over an older checkout.
            self.data["deepseek_key_encrypted"] = ""
            self.save()
        except (ValueError, OSError):
            # Preserve the legacy ciphertext when the vault cannot be read/written.
            pass

    def key(self) -> str:
        if key := os.getenv("DEEPSEEK_API_KEY", "").strip():
            return key
        encrypted = self.data.get("deepseek_key_encrypted")
        if self.vault.exists():
            try:
                encrypted = json.loads(self.vault.read_text(encoding="utf-8")).get("deepseek_key_encrypted", "") or encrypted
            except (ValueError, OSError):
                raise ValueError("本机密钥文件无法读取，请在设置中重新保存 Key") from None
        return protect(encrypted, True) if encrypted else ""

    def public(self) -> dict:
        result = {k: v for k, v in self.data.items() if k not in {"token", "deepseek_key_encrypted"}}
        try:
            result["deepseek_configured"] = bool(self.key())
            result["deepseek_key_status"] = ("environment" if os.getenv("DEEPSEEK_API_KEY", "").strip() else "saved") if result["deepseek_configured"] else "missing"
        except ValueError:
            result["deepseek_configured"] = False
            result["deepseek_key_status"] = "unreadable"
        result["deepseek_key_location"] = str(self.vault)
        result["output_path"] = str(self.root / "sessions")
        return result

    def update(self, patch: dict):
        with self.lock:
            if key := str(patch.get("deepseek_key") or "").strip():
                atomic_json(self.vault, {"deepseek_key_encrypted": protect(key)})
                self.data["deepseek_key_encrypted"] = ""
            if patch.get("clear_deepseek_key"):
                atomic_json(self.vault, {"deepseek_key_encrypted": ""})
                self.data["deepseek_key_encrypted"] = ""
            allowed = set(self.data) - {"token", "deepseek_key_encrypted"}
            for k, v in patch.items():
                if k in allowed:
                    self.data[k] = v
            self.save()
