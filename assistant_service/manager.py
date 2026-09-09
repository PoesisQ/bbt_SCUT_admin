from __future__ import annotations

import math
import hashlib
import json
import re
import threading
import time
from pathlib import Path

from .analysis import Analyzer, AnalysisPaused, analysis_packs, merge_events, rule_events
from .settings import atomic_json
from .asr import Transcriber, validate_wav, repetitive_segments
from .media import Downloader, decode, split_wav


def append_segments(existing: list[dict], fresh: list[dict], key: str, offset: float, duration: float) -> list[dict]:
    result = [s for s in existing if s.get("chunk") != key]  # retries replace their own output
    for index, item in enumerate(fresh):
        start, end = offset + max(0, float(item["start"])), offset + min(duration, float(item["end"]))
        text = item["text"].strip()
        if not text or not math.isfinite(start + end) or end <= start:
            continue
        # A repaired earlier chunk must never deduplicate against a later lecture sentence.
        overlap = [s for s in result if s.get("chunk") != key and s["start"] <= start < s["end"]]
        previous = max((s["end"] for s in overlap), default=0)
        if start < previous and result:
            prior = max(overlap, key=lambda s: s["end"])["text"]
            for length in range(min(len(text), len(prior), 80), 2, -1):
                if prior[-length:] == text[:length]:
                    text = text[length:].lstrip("，。！？、 ")
                    start = max(start, previous)
                    break
            if end <= previous and any(re.sub(r"\W", "", text) == re.sub(r"\W", "", s["text"]) for s in overlap):
                continue
        if text and end > start:
            result.append({"id": f"{key}:{index}", "chunk": key, "start": round(start, 3), "end": round(end, 3), "text": text,
                           **{k: item[k] for k in ("quality", "language", "language_probability", "avg_logprob") if k in item}})
    return sorted(result, key=lambda s: (s["start"], s["end"]))


class Manager:
    def __init__(self, settings, store, transcriber=None, analyzer=None):
        self.settings, self.store = settings, store
        self.asr = transcriber or Transcriber(settings)
        self.analyzer = analyzer or Analyzer(settings)
        self.shutdown = threading.Event()
        self.threads = []
        self.last_finalize = 0

    def start(self):
        for lane in ("asr", "media", "analysis"):
            thread = threading.Thread(target=self.worker, args=(lane,), daemon=True, name=f"scut-{lane}")
            thread.start()
            self.threads.append(thread)

    def close(self):
        self.shutdown.set()

    def worker(self, lane):
        while not self.shutdown.is_set():
            job = self.store.claim(lane)
            if not job:
                if lane == "asr":
                    self.finalize(force=False)
                self.shutdown.wait(0.4)
                continue
            self.execute(job)
            self.finalize()

    def execute(self, job):
        sid, lane = job["session_id"], job["lane"]
        if self.store.get(sid)["status"] == "cancelled":
            self.store.finish(job["id"])
            return
        try:
            self.run(job)
            self.store.finish(job["id"])
        except AnalysisPaused:
            self.store.finish(job["id"])
        except Exception as exc:
            # Do not include URLs, authorization headers or third-party bodies in errors.
            error = str(exc) if isinstance(exc, ValueError) else f"{type(exc).__name__}：处理失败，请检查本地配置后重试"
            self.store.finish(job["id"], error)
            if self.store.get(sid)["status"] != "cancelled":
                changes = {"warning" if lane == "analysis" else "error": error}
                if lane == "analysis":
                    changes["analysis_status"] = "failed"
                    if job["kind"] == "summary":
                        attempt = self.store.get(sid).get("notes_auto_attempts", 1)
                        changes["notes_retry_at"] = time.time() + 60 * 5 ** min(max(attempt - 1, 0), 2)
                self.store.update(sid, **changes)

    def run(self, job):
        sid, payload, kind = job["session_id"], job["payload"], job["kind"]
        if kind in {"chunk", "repair"}:
            path = Path(payload["path"])
            started = time.monotonic()
            fresh = self.asr.transcribe(path)
            if repetitive_segments(fresh):
                # Also protect alternative engines (such as XXL) from sending loops to analysis.
                path.with_suffix(".asr.json").write_text(json.dumps({"audio": path.name, "reason": "extreme_repetition", "raw": fresh}, ensure_ascii=False, indent=2), encoding="utf-8")
                fresh = [{"start": min(s["start"] for s in fresh), "end": max(s["end"] for s in fresh),
                          "text": "〔此段识别不可靠，已保留音频待复核〕", "quality": "uncertain"}]
            if self.store.get(sid)["status"] == "cancelled":
                return
            with self.store.lock:
                session = self.store.get(sid)
                chunk_key = payload.get("replace_key", job["id"])
                segments = append_segments(session["segments"], fresh, chunk_key, payload["start"], payload["duration"])
                added = [s for s in segments if s["chunk"] == chunk_key]
                previous_events = [e for e in session["events"] if not (kind == "repair" and any(i.startswith(chunk_key + ":") for i in e["segment_ids"]))]
                events = merge_events(previous_events, rule_events(added))
                self.store.update(sid, segments=segments, events=events,
                                  last_latency=round(time.monotonic() - started, 2), error="")
                self.maybe_analyze(sid)
        elif kind == "media":
            folder = self.store.directory(sid) / "media"
            folder.mkdir(exist_ok=True)
            cancelled = lambda: self.shutdown.is_set() or self.store.get(sid)["status"] == "cancelled"
            self.store.update(sid, status="downloading")
            source = Downloader(self.settings, cancelled, lambda t: self.store.update(sid, progress=t)).fetch(payload["url"], folder)
            self.store.update(sid, status="transcribing", progress="提取音轨")
            wav = folder / "audio.wav"
            decode(self.settings, source, wav, cancelled)
            for path, start, duration in split_wav(wav, folder):
                if cancelled():
                    return
                self.store.enqueue(sid, "chunk", {"path": str(path), "start": start, "duration": duration},
                                   key=f"{sid}-replay-{int(start)}", priority=20)
            self.store.update(sid, stopped=True, progress="音轨已就绪，按顺序转写")
        elif kind in {"analyze", "summary"}:
            session = self.store.get(sid)
            saved_summary = session.get("summary")
            reset_at = session.get("analysis_reset_at", 0)
            if job.get("created", time.time()) < reset_at:
                return
            self.store.update(sid, analysis_status="running", analysis_stage="segments", warning="")
            segments = [s for s in session["segments"] if s.get("quality") != "uncertain"]
            if kind == "analyze":
                segments = [s for s in segments if payload["start"] <= s["end"] <= payload["end"]]
                packs = [segments]
            else:
                packs = analysis_packs(segments)
            model = self.settings.data["deepseek_model"]
            fingerprint = hashlib.sha256(json.dumps(["summary-v2", model, reset_at, segments], ensure_ascii=False, sort_keys=True).encode()).hexdigest()
            checkpoint = self.store.directory(sid) / "analysis-cache" / (fingerprint + ".json")
            completed = {}
            if kind == "summary" and checkpoint.exists():
                try:
                    completed = json.loads(checkpoint.read_text(encoding="utf-8"))
                except (ValueError, OSError):
                    completed = {}
            overviews, topics, sections = [], [], []
            if kind == "summary":
                done = sum(str(i) in completed for i in range(len(packs)))
                self.store.update(sid, analysis_done=done, analysis_total=len(packs),
                                  analysis_progress=f"{done}/{len(packs)}", analysis_model=model)
            for index, pack in enumerate(packs):
                if self.store.get(sid)["status"] == "cancelled" or self.shutdown.is_set():
                    return
                if kind == "analyze" and self.store.get(sid).get("analysis", True) is False:
                    self.store.update(sid, analysis_status="paused")
                    return
                if self.settings.data["deepseek_model"] != model:
                    raise ValueError("分析模型已切换，请点击继续生成笔记，使用新模型整理本课")
                result = completed.get(str(index))
                if result is None:
                    result = self.analyzer.analyze(pack, summary=kind == "summary")
                if self.settings.data["deepseek_model"] != model:
                    raise ValueError("分析模型已切换，请点击继续生成笔记，使用新模型整理本课")
                if kind == "summary":
                    completed[str(index)] = result
                    atomic_json(checkpoint, completed)
                topics.extend(result["topics"])
                overviews.append(result["overview"])
                sections.append({"start": pack[0]["start"], "end": pack[-1]["end"], "overview": result["overview"]})
                with self.store.lock:
                    session = self.store.get(sid)
                    if session.get("analysis_reset_at", 0) != reset_at or session["status"] == "cancelled":
                        return  # The user started a transcription repair; this response is stale.
                    partial = {"summary": {"overview": "\n\n".join(overviews), "topics": topics,
                               "sections": sections, "source": "deepseek", "partial": True},
                               "analysis_done": index + 1, "analysis_total": len(packs)} if kind == "summary" else {}
                    if saved_summary and not saved_summary.get("partial"):
                        partial.pop("summary", None)  # Keep the readable old notes during a refresh.
                    self.store.update(sid, events=(merge_events(session["events"], result["events"]) if kind == "analyze" else session["events"]),
                                      analysis_progress=f"{index + 1}/{len(packs)}", **partial)
                if kind == "summary":
                    while urgent := self.store.claim("analysis", max_priority=0):
                        self.execute(urgent)
            update = {"analysis_status": "complete", "warning": ""}
            if kind == "summary":
                self.store.update(sid, analysis_progress="生成整课概览", analysis_stage="outline")
                outline = completed.get("outline")
                if outline is None:
                    outline = self.analyzer.synthesize(topics)
                    completed["outline"] = outline
                    atomic_json(checkpoint, completed)
                if self.settings.data["deepseek_model"] != model:
                    raise ValueError("分析模型已切换，请点击继续生成笔记，使用新模型整理本课")
                def check_context():
                    current = self.store.get(sid)
                    if current["status"] == "cancelled" or current.get("analysis_reset_at", 0) != reset_at or self.shutdown.is_set():
                        raise AnalysisPaused()
                    if self.settings.data["deepseek_model"] != model:
                        raise ValueError("分析模型已切换，请使用新模型继续整理本课")

                check_context()
                self.store.update(sid, analysis_progress="通读全文，合并作业与要求", analysis_stage="events")
                event_cache = completed.setdefault("context-events-v3", {})
                events = self.analyzer.consolidate(segments, checkpoint=event_cache,
                                                  save=lambda: atomic_json(checkpoint, completed), check=check_context)
                check_context()
                # Commit the new semantic list only after the entire pass succeeds.
                # Keep keyword hits for inspection, but never present them as finished notes.
                update.update(events=events, rule_candidates=rule_events(segments), events_version=3)
                update["summary"] = {"overview": "\n\n".join(overviews), "topics": topics, "sections": sections,
                                     "source": "deepseek", "partial": False, "headline": outline["title"],
                                     "abstract": outline["overview"], "groups": outline["groups"]}
                update.update(analysis_progress=f"{len(packs)}/{len(packs)}", analysis_stage="complete")
            with self.store.lock:
                current = self.store.get(sid)
                if current.get("analysis_reset_at", 0) == reset_at and current["status"] != "cancelled" and (kind == "summary" or current.get("analysis", True)):
                    self.store.update(sid, **update)

    def maybe_analyze(self, sid):
        session = self.store.get(sid)
        if any(j["kind"] == "repair" and j["state"] in {"pending", "running"} for j in self.store.jobs(sid)):
            return
        if not session.get("analysis") or session["mode"] != "live" or not session["segments"]:
            return
        end = max(s["end"] for s in session["segments"])
        if end - session["last_analysis_end"] < self.settings.data["analysis_window"]:
            return
        if self.store.pending(sid, "analysis"):
            return
        self.store.enqueue(sid, "analyze", {"start": max(0, session["last_analysis_end"] - 90), "end": end},
                           lane="analysis", priority=0)
        self.store.update(sid, last_analysis_end=end)

    def finalize(self, *, force=True):
        with self.store.lock:
            if not force and time.monotonic() - self.last_finalize < 5:
                return
            self.last_finalize = time.monotonic()
            for session in self.store.list():
                sid = session["id"]
                if session["status"] in {"cancelled", "complete", "failed"}:
                    continue
                jobs = self.store.jobs(sid)
                repairs = [j for j in jobs if j["kind"] == "repair"]
                if repairs:
                    repair_status = "running" if any(j["state"] in {"pending", "running"} for j in repairs) else "failed" if any(j["state"] == "failed" for j in repairs) else "complete"
                    if session.get("repair_status") != repair_status:
                        self.store.update(sid, repair_status=repair_status)
                audio = [j for j in jobs if j["lane"] in {"asr", "media"}]
                if any(j["state"] == "failed" for j in audio):
                    if session["stopped"] or session["mode"] != "live":
                        self.store.update(sid, status="failed")
                    continue
                if not session["stopped"] or any(j["state"] in {"pending", "running"} for j in audio):
                    continue
                self.store.update(sid, status="complete", progress="处理完成")
                if not self.settings.data["retain_audio"]:
                    # Only temporary audio/media created inside this generated session directory.
                    directory = self.store.directory(sid).resolve()
                    for child in directory.rglob("*"):
                        if child.is_file() and child.suffix in {".wav", ".bin", ".media", ".m3u8"} and child.resolve().is_relative_to(directory):
                            # Keep a flagged input and its recognition audit for review.
                            audit = child.with_suffix(".asr.json")
                            if not audit.exists():
                                child.unlink()
            self.queue_saved_notes()

    def queue_saved_notes(self):
        """Reconcile saved subtitles independently of the live reminder preference.

        Call under the store lock. Persist attempt counts so reopening the service
        cannot endlessly repeat a failing paid request. Successful packs resume
        from the existing analysis cache.
        """
        try:
            key = self.settings.key()
        except ValueError:
            key = ""  # A vault error must not stop the audio worker or subtitle saving.
        for session in self.store.records():
            sid = session["id"]
            if session.get("superseded_by") or not session["stopped"] or session["status"] != "complete":
                continue
            if not any(s.get("quality") != "uncertain" for s in session["segments"]):
                continue
            summary = session.get("summary")
            if summary and not summary.get("partial") and session.get("analysis_status") == "complete":
                continue
            jobs = self.store.jobs(sid)
            if any(j["state"] in {"pending", "running"} or (j["lane"] != "analysis" and j["state"] == "failed") for j in jobs):
                continue
            if not key:
                if session.get("analysis_status") != "waiting_key":
                    self.store.update(sid, analysis_status="waiting_key", analysis_progress="保存 Key 后自动生成笔记")
                continue
            generation = hashlib.sha256(json.dumps([self.settings.data["deepseek_model"], key,
                session.get("analysis_reset_at", 0), session["segments"]], ensure_ascii=False, sort_keys=True).encode()).hexdigest()
            same = session.get("notes_auto_generation") == generation
            attempts = session.get("notes_auto_attempts", 0) if same else 0
            if attempts >= 3 or (same and session.get("notes_retry_at", 0) > time.time()):
                continue
            attempt = attempts + 1
            self.store.enqueue(sid, "summary", {}, lane="analysis", priority=10,
                               key=f"{sid}-auto-notes-{generation}-{attempt}")
            self.store.update(sid, analysis_status="queued", analysis_progress="等待自动整理", warning="",
                              notes_auto_generation=generation, notes_auto_attempts=attempt, notes_retry_at=0)
