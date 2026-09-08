from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path

from .settings import atomic_json
from subtitle import json_to_srt as to_srt, json_to_text as to_txt


class Store:
    def __init__(self, root: Path):
        self.root = root
        self.lock = threading.RLock()
        self.db = sqlite3.connect(root / "assistant.sqlite3", check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS jobs(
                id TEXT PRIMARY KEY, session_id TEXT NOT NULL, lane TEXT NOT NULL,
                kind TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL,
                priority INTEGER NOT NULL, created REAL NOT NULL, error TEXT);
            CREATE INDEX IF NOT EXISTS job_queue ON jobs(lane,state,priority,created);
        """)
        # Interrupted work stays reviewable and can be explicitly retried.
        self.db.execute("UPDATE jobs SET state='failed',error='本地服务重启中断了任务，请重试' WHERE state='running'")
        self.db.commit()
        for s in self.list():
            if s["mode"] == "live" and s["status"] in {"recording", "stopping"}:
                self.update(s["id"], status="interrupted", warning="浏览器或服务重启；已接收音频保留，可完成已接收内容")

    def get(self, sid: str) -> dict:
        with self.lock:
            row = self.db.execute("SELECT data FROM sessions WHERE id=?", (sid,)).fetchone()
            if not row:
                raise KeyError("课时任务不存在")
            return json.loads(row[0])

    def list(self) -> list[dict]:
        with self.lock:
            return [json.loads(r[0]) for r in self.db.execute("SELECT data FROM sessions ORDER BY rowid DESC")]

    def create(self, lesson: dict) -> dict:
        sid = uuid.uuid4().hex
        value = {
            **lesson, "id": sid, "created_at": time.time(), "updated_at": time.time(),
            "status": "recording" if lesson["mode"] == "live" else "queued",
            "segments": [], "events": [], "summary": None, "analysis_status": "idle",
            "warning": "", "error": "", "stopped": False, "last_analysis_end": 0,
        }
        with self.lock:
            self.db.execute("INSERT INTO sessions VALUES(?,?)", (sid, json.dumps(value, ensure_ascii=False)))
            self.db.commit()
            self.export(value)
        return value

    def update(self, sid: str, **changes) -> dict:
        with self.lock:
            value = self.get(sid)
            value.update(changes, updated_at=time.time())
            self.db.execute("UPDATE sessions SET data=? WHERE id=?", (json.dumps(value, ensure_ascii=False), sid))
            self.db.commit()
            self.export(value)
            return value

    def directory(self, sid: str) -> Path:
        # IDs are generated locally; containment is checked again for exports.
        if len(sid) != 32 or any(c not in "0123456789abcdef" for c in sid):
            raise ValueError("无效任务 ID")
        path = self.root / "sessions" / sid
        path.mkdir(parents=True, exist_ok=True)
        return path

    def export(self, value: dict):
        directory = self.directory(value["id"])
        atomic_json(directory / "session.json", value)
        items = [{"BeginSec": x["start"], "EndSec": x["end"], "Text": x["text"]} for x in value["segments"]]
        atomic_json(directory / "subtitles.json", items)
        (directory / "subtitles.srt").write_text(to_srt(items), encoding="utf-8")
        (directory / "subtitles.txt").write_text(to_txt(items), encoding="utf-8")
        atomic_json(directory / "events.json", value["events"])
        lines = [f"# {value.get('course_title', '')} · {value.get('title', '')}", "",
                 f"来源：{value.get('page_url', '')}", f"状态：{value['status']}", ""]
        if summary := value.get("summary"):
            lines += ["## 本课概览", summary.get("overview", ""), "", "## 内容时间线"]
            for topic in summary.get("topics", []):
                lines += [f"- [{topic.get('start', 0):.0f}s] {topic['title']} · {topic.get('chapter') or '未明确章节'}：{topic.get('detail', '')}"]
        lines += ["", "## 重点提醒（请核对原文）"]
        for event in value["events"]:
            lines += [f"- [{event['start']:.0f}s] **{event['label']}** {event['message']} ({event['source']})",
                      f"  原文：{event['evidence']}"]
        if value.get("warning"):
            lines += ["", "提示：" + value["warning"]]
        (directory / "notes.md").write_text("\n".join(lines), encoding="utf-8")

    def enqueue(self, sid: str, kind: str, payload: dict, lane="asr", priority=10, key=None):
        jid = key or uuid.uuid4().hex
        with self.lock:
            self.db.execute("INSERT OR IGNORE INTO jobs VALUES(?,?,?,?,?,'pending',?,?,NULL)",
                            (jid, sid, lane, kind, json.dumps(payload, ensure_ascii=False), priority, time.time()))
            self.db.commit()
        return jid

    def claim(self, lane: str, max_priority: int | None = None):
        with self.lock:
            query = "SELECT * FROM jobs WHERE lane=? AND state='pending'"
            args = [lane]
            if max_priority is not None:
                query += " AND priority<=?"
                args.append(max_priority)
            row = self.db.execute(query + " ORDER BY priority,created LIMIT 1", args).fetchone()
            if row:
                self.db.execute("UPDATE jobs SET state='running' WHERE id=?", (row["id"],))
                self.db.commit()
                return {**dict(row), "payload": json.loads(row["payload"])}

    def finish(self, jid: str, error: str = ""):
        with self.lock:
            self.db.execute("UPDATE jobs SET state=?,error=? WHERE id=?", ("failed" if error else "done", error, jid))
            self.db.commit()

    def jobs(self, sid: str | None = None) -> list[dict]:
        with self.lock:
            query = "SELECT id,session_id,lane,kind,state,error,created FROM jobs"
            rows = self.db.execute(query + (" WHERE session_id=?" if sid else "") + " ORDER BY created", (sid,) if sid else ())
            return [dict(row) for row in rows]

    def pending(self, sid: str, lane: str) -> bool:
        return any(j["lane"] == lane and j["state"] in {"pending", "running"} for j in self.jobs(sid))

    def retry(self, sid: str):
        with self.lock:
            self.db.execute("UPDATE jobs SET state='pending',error=NULL WHERE session_id=? AND state='failed'", (sid,))
            self.db.commit()

    def audio_inputs(self, sid: str):
        with self.lock:
            return [{"id": row["id"], **json.loads(row["payload"])} for row in self.db.execute(
                "SELECT id,payload FROM jobs WHERE session_id=? AND kind='chunk' ORDER BY created", (sid,))]

    def cancel_pending_analysis(self, sid: str):
        with self.lock:
            self.db.execute("UPDATE jobs SET state='cancelled' WHERE session_id=? AND lane='analysis' AND state='pending'", (sid,))
            self.db.commit()

    def cancel(self, sid: str):
        with self.lock:
            self.db.execute("UPDATE jobs SET state='cancelled' WHERE session_id=? AND state='pending'", (sid,))
            self.db.commit()
            self.update(sid, status="cancelled", stopped=True)
