import json
from pathlib import Path

from config import OUTPUT_DIR


def format_time(seconds: float) -> str:
    h = int(seconds) // 3600
    m = (int(seconds) % 3600) // 60
    s = int(seconds) % 60
    ms = int((seconds - int(seconds)) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def json_to_srt(subtitle_json: list[dict]) -> str:
    lines = []
    for i, item in enumerate(subtitle_json, 1):
        begin = item.get("BeginSec", 0)
        end = item.get("EndSec", begin + 5)
        text = item.get("Text", "").strip()
        if not text:
            continue

        lines.append(str(i))
        lines.append(f"{format_time(begin)} --> {format_time(end)}")
        lines.append(text)
        lines.append("")

    return "\n".join(lines)


def save_subtitle(
    subtitle_json: list[dict], sub_id: str, course_name: str | None = None
) -> tuple[Path, Path]:
    json_dir = OUTPUT_DIR / "json"
    srt_dir = OUTPUT_DIR / "srt"
    json_dir.mkdir(parents=True, exist_ok=True)
    srt_dir.mkdir(parents=True, exist_ok=True)

    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in (course_name or sub_id))
    base_name = f"{safe_name}_{sub_id}"

    json_path = json_dir / f"{base_name}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(subtitle_json, f, ensure_ascii=False, indent=2)

    srt_content = json_to_srt(subtitle_json)
    srt_path = srt_dir / f"{base_name}.srt"
    with open(srt_path, "w", encoding="utf-8") as f:
        f.write(srt_content)

    return json_path, srt_path
