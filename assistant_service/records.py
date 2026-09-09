"""Lesson membership and comparable time coverage; recordings remain recoverable on disk."""
from __future__ import annotations


def ranges(values):
    result = []
    for start, end in sorted(values):
        if end <= start:
            continue
        if result and start <= result[-1][1] + 0.05:
            result[-1][1] = max(end, result[-1][1])
        else:
            result.append([start, end])
    return result


def contains(outer, inner):
    return bool(inner) and all(any(a <= c + 0.05 and b >= d - 0.05 for a, b in outer) for c, d in inner)


def annotate(sessions, inputs):
    rows = []
    for s in sessions:
        if s.get("deleted_at"):
            continue
        source = "school" if s["mode"] == "subtitle" else "asr"
        aligned = s.get("time_basis", "video") == "video"
        audio = inputs(s["id"]) if source == "asr" else []
        intervals = ranges((p["start"], p["start"] + p["duration"]) for p in audio)
        if not intervals and s["segments"]:
            # Legacy records have no audio job metadata: only their observed span is known.
            intervals = [[min(x["start"] for x in s["segments"]), max(x["end"] for x in s["segments"])]]
        rows.append({**s, "source_kind": source, "coverage": intervals,
                     "coverage_seconds": sum(b - a for a, b in intervals),
                     "source_label": "学校字幕" if source == "school" else "本地转写" if aligned else "直播录音（独立计时）",
                     "superseded_by": None})
    for s in rows:
        # Capture-relative zero is not a lesson timestamp. Never compare different live recordings.
        if s.get("time_basis") == "capture" or s["status"] != "complete":
            continue
        peers = [p for p in rows if p["id"] != s["id"] and p["course_id"] == s["course_id"] and p["sub_id"] == s["sub_id"]
                 and p["source_kind"] == s["source_kind"] and p.get("time_basis", "video") == "video"
                 and p["status"] == "complete" and p["segments"]
                 and contains(p["coverage"], s["coverage"])
                 and (not contains(s["coverage"], p["coverage"]) or (p["created_at"], p["id"]) > (s["created_at"], s["id"]))]
        if peers:
            s["superseded_by"] = max(peers, key=lambda p: (p["coverage_seconds"], p["created_at"], p["id"]))["id"]
    return rows
