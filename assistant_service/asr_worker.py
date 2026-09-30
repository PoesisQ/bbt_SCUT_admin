"""Private line protocol for the isolated resident recognizer."""
from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace

from .asr import Transcriber


def reply(value):
    # ASCII framing survives Windows consoles configured for legacy code pages.
    sys.stdout.write("@SCUT-ASR@" + json.dumps(value, ensure_ascii=True) + "\n")
    sys.stdout.flush()


def main():
    initial = json.loads(sys.stdin.readline())
    settings = SimpleNamespace(data=initial["config"], root=Path(initial["root"]))
    transcriber = Transcriber(settings, isolated=False)
    for line in sys.stdin:
        try:
            request = json.loads(line)
            segments = transcriber.transcribe(Path(request["path"]))
            reply({"ok": True, "segments": segments})
        except Exception as exc:
            # Paths, audio contents and third-party errors stay out of the protocol.
            message = str(exc) if isinstance(exc, ValueError) else f"本地识别失败（{type(exc).__name__}）"
            reply({"ok": False, "error": message, "error_type": type(exc).__name__})


if __name__ == "__main__":
    main()
