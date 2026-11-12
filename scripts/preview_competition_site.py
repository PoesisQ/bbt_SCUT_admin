"""Serve the competition preview and its private course notes on loopback."""

from __future__ import annotations

import argparse
import functools
import hashlib
import json
import os
import sqlite3
from contextlib import closing
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


SITE = Path(__file__).resolve().parents[1] / "competition" / "site"
DEFAULT_DB = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "SCUTClassroomAssistant/data/assistant.sqlite3"


def read_notes(database: Path) -> dict:
    lessons = {}
    with closing(sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True)) as db:
        for (data,) in db.execute("SELECT data FROM sessions ORDER BY rowid DESC"):
            record = json.loads(data)
            summary = record.get("summary") or {}
            if (record.get("course_title") != "神经科学" or record.get("deleted_at")
                    or record.get("status") != "complete"
                    or record.get("analysis_status") != "complete" or summary.get("partial")
                    or not summary.get("topics")):
                continue
            title = record["title"]
            if title in lessons:
                continue
            lesson_id = hashlib.sha256(title.encode("utf-8")).hexdigest()[:16]
            notes = {key: summary[key] for key in ("headline", "abstract", "overview", "groups", "sections") if key in summary}
            notes["topics"] = [
                {key: topic[key] for key in ("title", "detail", "chapter", "start", "end") if key in topic}
                for topic in summary["topics"]
            ]
            lessons[title] = {"id": f"neuro-{lesson_id}", "title": title, "summary": notes}
    return {"version": 1, "lessons": [lessons[title] for title in sorted(lessons, reverse=True)]}


class PreviewHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, database: Path):
        self.database = database
        super().__init__(*args, directory=str(SITE))

    def do_GET(self):
        if self.path != "/local-course-notes":
            return super().do_GET()
        port = self.server.server_port
        if (self.headers.get("Host") not in {f"127.0.0.1:{port}", f"localhost:{port}"}
                or self.headers.get("Sec-Fetch-Site") == "cross-site"):
            self.send_error(403)
            return
        try:
            payload = json.dumps(read_notes(self.database), ensure_ascii=False).encode("utf-8")
        except (OSError, sqlite3.Error, ValueError):
            self.send_error(503, "Local notes are unavailable")
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=DEFAULT_DB)
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--export", type=Path, help="Write a course-note JSON file for browser import")
    args = parser.parse_args()
    if args.export:
        target = args.export.resolve()
        if target.is_relative_to(SITE) or target == args.database.resolve():
            parser.error("Export to a separate private file outside the site's static directory")
        target.write_text(json.dumps(read_notes(args.database), ensure_ascii=False), encoding="utf-8")
        return
    handler = functools.partial(PreviewHandler, database=args.database)
    with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
        print(f"Preview at http://127.0.0.1:{server.server_port}/", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
