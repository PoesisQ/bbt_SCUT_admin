import json
import unittest
from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory

from assistant_service.study_agent.mcp import Server
from assistant_service.study_agent.planner import make_plan
from assistant_service.study_agent.storage import StudyStore


class DeadlineChangeTests(unittest.TestCase):
    def setUp(self):
        temp = TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.store = StudyStore(Path(temp.name))
        self.course = "数字电路"
        self.task = self.store.save("task", {"course": self.course, "title": "时序实验",
            "status": "accepted", "deadline": "2099-11-16", "estimate_min": 20, "estimate_max": 35,
            "spent_minutes": 5}, "lab")
        self.quote = "时序实验提前到2099年11月15日20:00截止。"
        self.evidence = self.source(self.course, self.quote)
        self.server = self.connect()

    def source(self, course, quote, version="v1", kind="material", origin="notice"):
        return self.store.source(origin=origin, course=course, title="实验通知", kind=kind, fingerprint=version,
                                 chunks=[{"text": quote, "locator": {"page": 1}}])["id"] + ":0"

    def connect(self):
        server = Server(StudyStore(self.store.path.parent))
        server.handle({"jsonrpc": "2.0", "method": "initialize", "id": 1})
        server.handle({"jsonrpc": "2.0", "method": "notifications/initialized"})
        return server

    def call(self, name, *, ok=True, **arguments):
        response = self.server.handle({"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                                       "params": {"name": name, "arguments": arguments}})
        self.assertIn("result", response, response)
        result = response["result"]
        self.assertEqual(result["isError"], not ok, result)
        output = result["content"][0]["text"]
        return json.loads(output) if ok else output

    def preview(self, **overrides):
        arguments = {"task_id": "lab", "evidence_id": self.evidence, "quote": self.quote,
                     "deadline_at": "2099-11-15T12:00:00Z", "publisher_status": "verified_teacher",
                     "available_windows": [self.block("19:00", "20:30")]}
        return self.call("prepare_task_deadline_change", **(arguments | overrides))

    @staticmethod
    def block(start, end, **extra):
        return {"start": f"2099-11-15T{start}:00+08:00", "end": f"2099-11-15T{end}:00+08:00", **extra}

    def test_confirm_moves_only_affected_blocks_and_can_be_replayed(self):
        other = self.block("19:05", "19:15", task_id="other", reason="另一门课")
        kept = self.block("19:20", "19:30", task_id="lab", reason="前置练习")
        locked = self.block("20:10", "20:20", task_id="lab", locked=True)
        completed = self.block("20:20", "20:25", task_id="lab", completed=True)
        displaced = self.block("20:30", "20:50", task_id="lab", reason="写报告")
        self.store.save("plan", {"status": "accepted", "blocks": [other, kept, locked, completed, displaced],
                                 "risks": [{"task_id": "other", "text": "既有提示"}]}, "week")
        self.store.save("timetable", {"status": "accepted", "busy": [self.block("19:30", "19:45")]})
        session = self.call("open_learning_session", course=self.course, goal="完成时序实验", request_id="open")
        draft = self.preview(session_id=session["id"])
        self.assertEqual(draft["status"], "pending_confirmation")
        self.assertEqual(draft["before"]["deadline"], "2099-11-16")
        self.assertEqual(draft["after"]["deadline_at"], "2099-11-15T20:00:00+08:00")
        self.assertEqual(draft["plan"]["id"], "week")
        self.assertEqual(draft["plan"]["removed_blocks"], [displaced])
        self.assertEqual(draft["plan"]["unscheduled_minutes"], 0)
        added = draft["plan"]["added_blocks"]
        self.assertEqual([(b["start"][11:16], b["end"][11:16]) for b in added],
                         [("19:00", "19:05"), ("19:15", "19:20"), ("19:45", "19:55")])
        self.assertEqual(self.store.get("lab", "task"), self.task)

        result = self.call("confirm_task_deadline_change", change_id=draft["id"])
        self.assertEqual(result["status"], "applied")
        task = self.store.get("lab", "task")
        self.assertEqual(task["spent_minutes"], 5)
        self.assertEqual(task["deadline"], "2099-11-15")
        self.assertEqual(task["deadline_at"], draft["after"]["deadline_at"])
        plan = self.store.get("week", "plan")
        self.assertCountEqual(plan["blocks"], [other, kept, locked, completed, *added])
        self.assertIn({"task_id": "other", "text": "既有提示"}, plan["risks"])
        self.assertEqual(self.preview(session_id=session["id"])["id"], draft["id"])
        self.assertEqual(self.call("confirm_task_deadline_change", change_id=draft["id"]), result)
        self.assertEqual(self.store.get("lab", "task"), task)
        self.assertEqual(self.store.get("week", "plan"), plan)

        self.server = self.connect()
        recovered = self.call("get_task_deadline_change", task_id="lab")
        self.assertEqual(recovered["id"], draft["id"])
        self.assertEqual(recovered["session_id"], session["id"])
        self.assertEqual(recovered["status"], "applied")
        current = self.call("list_confirmed_study_tasks")[0]
        self.assertEqual(current["deadline_at"], task["deadline_at"])
        self.assertEqual(current["deadline_evidence"]["quote"], self.quote)
        resumed = self.call("get_learning_session", session_id=session["id"])
        self.assertEqual(resumed["linked_task"]["id"], task["id"])
        self.assertEqual(resumed["linked_task"]["deadline_at"], task["deadline_at"])
        context = self.call("prepare_learning_context", course=self.course, topic="时序实验")
        self.assertEqual(context["confirmed_tasks"][0]["deadline_evidence"]["evidence_id"], self.evidence)
        today = self.call("plan_today_review", course=self.course, minutes=30)
        self.assertEqual(today["steps"][0]["citations"][0]["evidence_id"], self.evidence)

        rumor = self.preview(publisher_status="unverified", deadline_at="2099-11-15T18:00:00+08:00")
        after_rumor = self.call("get_task_deadline_change", task_id="lab")
        self.assertEqual(after_rumor["id"], rumor["id"])
        self.assertEqual(after_rumor["current_change"]["id"], draft["id"])
        self.assertTrue(after_rumor["current_change"]["is_current"])
        self.source(self.course, self.quote + "请核对新通知。", version="v2")
        self.assertEqual(self.call("list_confirmed_study_tasks")[0]["deadline_evidence"]["status"], "unavailable")

    def test_unverified_and_cross_course_notices_cannot_change_a_task(self):
        draft = self.preview(publisher_status="unverified")
        self.assertEqual(draft["status"], "needs_review")
        self.call("confirm_task_deadline_change", change_id=draft["id"], ok=False)
        foreign = self.source("另一个班", self.quote)
        self.preview(evidence_id=foreign, ok=False)
        self.preview(quote="这段是模型编造的截止时间。", ok=False)
        self.preview(deadline_at="2099-11-15T20:00:00", ok=False)
        self.preview(deadline_at="2099-11-15T20:01:00+08:00", ok=False)
        report = self.source(self.course, self.quote, version="report", kind="student_report", origin="student")
        self.preview(evidence_id=report, ok=False)
        self.assertEqual(self.store.get("lab", "task"), self.task)

    def test_same_old_notice_with_a_shorter_excerpt_cannot_replace_newer_deadline(self):
        older = self.preview(available_windows=[])
        self.call("confirm_task_deadline_change", change_id=older["id"])
        quote = "时序实验改为2099年11月15日19:30截止。"
        evidence = self.source(self.course, quote, version="v2", origin="second-notice")
        newer = self.preview(evidence_id=evidence, quote=quote, deadline_at="2099-11-15T19:30:00+08:00",
                             available_windows=[])
        self.call("confirm_task_deadline_change", change_id=newer["id"])
        repeated = self.preview(quote="2099年11月15日20:00截止")
        self.assertEqual(repeated["id"], older["id"])
        self.assertFalse(repeated["is_current"])
        self.assertEqual(self.store.get("lab", "task")["deadline_at"], newer["after"]["deadline_at"])
        self.assertEqual(len(self.store.list("task_deadline_change")), 2)

    def test_named_foreign_time_zone_cannot_be_taken_as_local_time(self):
        quote = "2099年11月15日20:00（US Eastern Time）截止。"
        evidence = self.source(self.course, quote, version="eastern", origin="foreign-zone")
        self.preview(evidence_id=evidence, quote=quote, ok=False)
        quote = "2099年11月15日20:00（北京时间）截止。"
        evidence = self.source(self.course, quote, version="china", origin="china-zone")
        self.assertEqual(self.preview(evidence_id=evidence, quote=quote)["status"], "pending_confirmation")

    def test_stale_evidence_or_plan_prevents_confirmation(self):
        displaced = self.block("20:30", "20:50", task_id="lab")
        plan = self.store.save("plan", {"status": "accepted", "blocks": [displaced]}, "week")
        stale = self.preview()
        self.store.save("plan", {**plan, "blocks": [{**displaced, "locked": True}]}, "week")
        self.call("confirm_task_deadline_change", change_id=stale["id"], ok=False)
        fresh = self.preview()
        self.assertNotEqual(fresh["id"], stale["id"])
        self.source(self.course, self.quote, version="v2")
        self.call("confirm_task_deadline_change", change_id=fresh["id"], ok=False)
        self.assertEqual(self.store.get("lab", "task"), self.task)

    def test_unavailable_capacity_is_reported_even_when_due_time_is_confirmed(self):
        draft = self.preview(available_windows=[])
        self.assertEqual(draft["plan"]["added_blocks"], [])
        self.assertEqual(draft["plan"]["unscheduled_minutes"], 30)
        result = self.call("confirm_task_deadline_change", change_id=draft["id"])
        self.assertEqual(result["status"], "applied")
        self.assertEqual(self.store.list("plan"), [])

    def test_existing_planner_respects_precise_deadline(self):
        task = {**self.task, "deadline": "2099-11-15", "deadline_at": "2099-11-15T19:10:00+08:00"}
        plan = make_plan([task], start=date(2099, 11, 15), days=2, daily_minutes=45)
        self.assertEqual(len(plan["blocks"]), 1)
        self.assertEqual(plan["blocks"][0]["end"], task["deadline_at"])


if __name__ == "__main__":
    unittest.main()
