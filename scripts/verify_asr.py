"""Explicit local-file GPU/CPU smoke test, without model downloads or school requests."""
from pathlib import Path
import argparse
import json
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from assistant_service.asr import Transcriber
from assistant_service.settings import Settings


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("audio", type=Path)
    args = parser.parse_args()
    if not args.audio.is_file():
        parser.error("音频文件不存在")
    transcriber = Transcriber(Settings())
    begin = time.monotonic()
    transcriber.load()
    print(f"Model load: {time.monotonic() - begin:.2f}s")
    begin = time.monotonic()
    result = transcriber.transcribe(args.audio)
    print(f"Transcription: {time.monotonic() - begin:.2f}s; {len(result)} segments")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
