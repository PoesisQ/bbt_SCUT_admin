import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from assistant_service.manager import Manager
from assistant_service.settings import Settings
from assistant_service.store import Store


class AutoNotesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.settings = Settings(Path(self.temp.name))
        self.store = Store(self.settings.root)
        self.manager = Manager(self.settings, self.store)
        self.key = patch.object(self.settings, "key", return_value="test-key")
        self.key.start()

    def tearDown(self):
        self.key.stop()
        self.store.db.close()
        self.temp.cleanup()

    def saved(self, **changes):
        value = self.store.create(dict(mode="subtitle", course_id="1", sub_id="2", analysis=False))
        return self.store.update(value["id"], **{ "status": "complete", "stopped": True,
            "segments": [dict(id="a", start=0, end=60, text="下周五前交第二章作业。")], **changes})["id"]

    def test_backfill_all_sources_without_enabling_live_reminders_and_idempotent(self):
        ids = [self.saved(mode=mode, sub_id=str(i)) for i, mode in enumerate(["subtitle", "live", "replay"])]
        for _ in range(3):
            self.manager.finalize()
        self.assertEqual({j["session_id"] for j in self.store.jobs()}, set(ids))
        self.assertEqual(len(self.store.jobs()), 3)
        self.assertTrue(all(not self.store.get(s)["analysis"] for s in ids))

    def test_no_key_waits_and_new_key_automatically_releases_existing_subtitles(self):
        sid = self.saved()
        with patch.object(self.settings, "key", return_value=""):
            self.manager.finalize()
        self.assertEqual(self.store.get(sid)["analysis_status"], "waiting_key")
        self.assertEqual(self.store.jobs(), [])
        self.manager.finalize()
        self.assertEqual(self.store.get(sid)["analysis_status"], "queued")

    def test_complete_notes_deleted_and_covered_versions_are_skipped_even_while_winner_runs(self):
        old = self.saved()
        winner = self.saved()
        done = self.saved(sub_id="3", summary={"partial": False, "overview": "已有笔记"}, analysis_status="complete")
        deleted = self.saved(sub_id="4", deleted_at=1)
        self.manager.finalize()
        self.store.claim("analysis")
        self.store.update(winner, analysis_status="running")
        self.manager.finalize()
        self.assertEqual([j["session_id"] for j in self.store.jobs()], [winner])
        self.assertEqual(self.store.get(done)["summary"]["overview"], "已有笔记")
        self.assertFalse(self.store.jobs(old) or self.store.jobs(deleted))

    def test_active_recording_and_audio_work_and_cancelled_are_skipped(self):
        self.saved(mode="live", stopped=False, status="recording")
        sid = self.saved(sub_id="3")
        self.store.enqueue(sid, "repair", {})
        self.saved(sub_id="4", status="cancelled")
        self.manager.finalize()
        self.assertFalse(any(j["lane"] == "analysis" for j in self.store.jobs()))

    def test_saved_summary_runs_with_live_reminders_off(self):
        sid = self.saved()
        self.manager.finalize()
        with patch.object(self.manager.analyzer, "analyze", return_value={"overview": "本课内容", "topics": [], "events": []}), \
             patch.object(self.manager.analyzer, "synthesize", return_value={"title": "笔记", "overview": "概览", "groups": []}), \
             patch.object(self.manager.analyzer, "consolidate", return_value=[]):
            self.manager.execute(self.store.claim("analysis"))
        self.manager.finalize()
        self.assertFalse(self.store.get(sid)["analysis"])
        self.assertFalse(self.store.get(sid)["summary"]["partial"])
        self.assertEqual(len(self.store.jobs(sid)), 1)

    def test_failure_backoff_and_attempt_limit_survive_manager_restart(self):
        sid = self.saved()
        for attempt in range(1, 4):
            self.manager.finalize()
            job = self.store.claim("analysis")
            self.assertIsNotNone(job)
            with patch.object(self.manager.analyzer, "analyze", side_effect=ValueError("测试网络失败")):
                self.manager.execute(job)
            self.manager = Manager(self.settings, self.store)
            self.manager.finalize()
            self.assertIsNone(self.store.claim("analysis"))
            self.assertEqual(self.store.get(sid)["notes_auto_attempts"], attempt)
            self.store.update(sid, notes_retry_at=0)
        self.manager.finalize()
        self.assertEqual(len(self.store.jobs(sid)), 3)
        self.assertIsNone(self.store.claim("analysis"))
        self.settings.data["deepseek_model"] = "new-model"
        self.manager.finalize()
        self.assertIsNotNone(self.store.claim("analysis"))

    def test_live_preference_does_not_cancel_saved_notes(self):
        sid = self.saved()
        self.manager.finalize()
        self.store.enqueue(sid, "analyze", {}, lane="analysis")
        self.store.cancel_pending_analysis(sid, realtime_only=True)
        self.assertEqual([j["kind"] for j in self.store.jobs(sid) if j["state"] == "pending"], ["summary"])
