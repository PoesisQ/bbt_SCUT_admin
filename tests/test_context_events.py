import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from assistant_service.analysis import Analyzer, AnalysisPaused, context_packs, rule_events
from assistant_service.manager import Manager
from assistant_service.settings import Settings
from assistant_service.store import Store


ROWS = [
    {"id": "a", "start": 0, "end": 5, "text": "比如以前做过一个AI小作业。"},
    {"id": "b", "start": 30, "end": 35, "text": "本次作业看视频，写脑区名词解释。"},
    {"id": "c", "start": 36, "end": 40, "text": "下周二交。用白纸写，写上名字交助教。"},
    {"id": "d", "start": 2000, "end": 2005, "text": "刚才作业时间改为下周三，其他不变。"},
]


def answer():
    return {"events": [{"category": "assignment", "message": "观看视频后写脑区名词解释，下周三交助教",
        "segment_ids": ["s2", "s3", "s4"], "evidence_quotes": [ROWS[1]["text"], ROWS[2]["text"], ROWS[3]["text"]],
        "details": {"action": "观看视频，写脑区名词解释", "deadline": "下周三", "submission": "白纸写，署名交助教",
                    "requirements": "提交时间由下周二改为下周三"}}], "topics": [], "overview": ""}


class ContextEventTests(unittest.TestCase):
    def test_whole_text_sees_example_task_and_later_correction_in_one_request(self):
        with tempfile.TemporaryDirectory() as tmp:
            settings = Settings(Path(tmp))
            calls = []
            def respond(req):
                body = json.loads(req.content)
                rows = json.loads(body["messages"][1]["content"])["segments"]
                calls.append(rows)
                self.assertEqual([s["text"] for s in rows], [s["text"] for s in ROWS])
                return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(answer())}}]})
            cache = {}
            with patch.object(settings, "key", return_value="test-only"):
                analyzer = Analyzer(settings, httpx.MockTransport(respond))
                events = analyzer.consolidate(ROWS, checkpoint=cache)
                self.assertEqual(events, analyzer.consolidate(ROWS, checkpoint=cache))
            self.assertEqual(len(calls), 1)
            self.assertEqual(len(events), 1)
            self.assertEqual(events[0]["details"]["deadline"], "下周三")
            self.assertEqual(events[0]["segment_ids"], ["b", "c", "d"])

    def test_many_valid_short_subtitle_references_do_not_fail_the_entire_lecture(self):
        rows = [{"id": str(i), "start": i, "end": i+1, "text": "课堂片段"+str(i)} for i in range(45)]
        body = {"events": [{"category": "question", "message": "老师请同学讨论一个问题",
                           "segment_ids": [s["id"] for s in rows], "evidence_quotes": [s["text"] for s in rows]}]}
        self.assertEqual(len(Analyzer.validate(body, rows)["events"]), 1)

    def test_multiple_quotes_are_individually_verified(self):
        body = answer()
        body["events"][0]["segment_ids"] = ["b", "c", "d"]
        self.assertEqual(len(Analyzer.validate(body, ROWS)["events"]), 1)
        body["events"][0]["evidence_quotes"].append("作业占百分之三十")
        self.assertEqual(Analyzer.validate(body, ROWS)["events"], [])

    def test_long_lectures_overlap_without_losing_or_reordering_text(self):
        rows = [{"id": str(i), "start": i*4, "end": i*4+4, "text": "句子"*20} for i in range(80)]
        packs = context_packs(rows, budget=2000)
        self.assertEqual({s["id"] for p in packs for s in p}, {s["id"] for s in rows})
        self.assertTrue(set(s["id"] for s in packs[0]) & set(s["id"] for s in packs[1]))
        self.assertTrue(all(p == sorted(p, key=lambda s: s["start"]) for p in packs))

    def test_long_window_reconciliation_keeps_reclassified_notices_and_candidate_meaning(self):
        with tempfile.TemporaryDirectory() as tmp:
            analyzer = Analyzer(Settings(Path(tmp)))
            first = {"id": "e1", "category": "assignment", "message": "用白纸写作业", "details": {"submission": "交助教"},
                     "source": "deepseek", "segment_ids": ["b"], "start": 30, "end": 35}
            second = {**first, "id": "e2", "segment_ids": ["d"], "start": 2000, "end": 2005}
            reclassified = {**first, "category": "requirements", "message": "下周三用白纸提交给助教"}
            requests = []
            def request(rows, **kwargs):
                requests.append(kwargs)
                if kwargs.get("event_candidates") is not None:
                    self.assertEqual(len(kwargs["event_candidates"]), 2)
                    self.assertEqual(kwargs["event_candidates"][0]["details"]["submission"], "交助教")
                    self.assertEqual({r["id"] for r in rows}, {r["id"] for r in ROWS})
                    return {"events": [reclassified]}
                return {"events": [first if len(requests)==1 else second]}
            with patch("assistant_service.analysis.context_packs", return_value=[ROWS[:3], ROWS[2:]]), patch.object(analyzer, "_request", side_effect=request):
                result = analyzer.consolidate(ROWS)
            self.assertEqual(result, [reclassified])
            self.assertEqual(len(requests), 3)

    def test_evidence_is_read_from_source_ids_without_model_retyping(self):
        with tempfile.TemporaryDirectory() as tmp:
            settings = Settings(Path(tmp))
            def respond(req):
                content = answer()
                content["events"][0].pop("evidence_quotes")
                return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(content)}}]})
            with patch.object(settings, "key", return_value="test-only"):
                result = Analyzer(settings, httpx.MockTransport(respond)).consolidate(ROWS)
            self.assertEqual(result[0]["evidence_quotes"], [s["text"] for s in ROWS[1:]])

    def test_pause_after_request_keeps_checkpoint_uncommitted(self):
        with tempfile.TemporaryDirectory() as tmp:
            analyzer = Analyzer(Settings(Path(tmp)))
            calls = []
            def check():
                calls.append(1)
                if len(calls) == 2:
                    raise AnalysisPaused()
            cache = {}
            with patch.object(analyzer, "_request", return_value={"events": []}):
                with self.assertRaises(AnalysisPaused):
                    analyzer.consolidate(ROWS, checkpoint=cache, check=check)
            self.assertEqual(cache, {})

    def test_final_pass_replaces_keywords_only_after_success_and_exports_details(self):
        with tempfile.TemporaryDirectory() as tmp:
            settings = Settings(Path(tmp));store = Store(settings.root);manager = Manager(settings, store)
            sid = store.create({"mode": "subtitle", "analysis": True})["id"]
            original = rule_events(ROWS)
            store.update(sid, stopped=True, segments=ROWS, events=original)
            mapped = {"events": [], "topics": [], "overview": "课堂"}
            with patch.object(manager.analyzer, "analyze", return_value=mapped), patch.object(manager.analyzer, "consolidate", side_effect=ValueError("暂时失败")):
                store.enqueue(sid, "summary", {}, lane="analysis");manager.execute(store.claim("analysis"))
            self.assertEqual(store.get(sid)["events"], original)
            self.assertEqual(store.get(sid)["analysis_status"], "failed")
            body = answer();body["events"][0]["segment_ids"] = ["b", "c", "d"]
            events = Analyzer.validate(body, ROWS)["events"]
            with patch.object(manager.analyzer, "analyze", side_effect=AssertionError("cached")), patch.object(manager.analyzer, "consolidate", return_value=events):
                store.enqueue(sid, "summary", {}, lane="analysis");manager.execute(store.claim("analysis"))
            result = store.get(sid)
            self.assertEqual(result["events"], events)
            self.assertTrue(result["rule_candidates"])
            self.assertEqual(result["events_version"], 3)
            exported = (store.directory(sid)/"notes.md").read_text(encoding="utf-8")
            self.assertIn("提交方式：白纸写，署名交助教", exported)
            self.assertIn("时间：下周三", exported)
            store.db.close()
