from pathlib import Path
from tempfile import TemporaryDirectory
import json
import unittest
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient

from assistant_service.app import create_app
from assistant_service.settings import Settings
from assistant_service.store import Store
from assistant_service.study_agent.daily import daily_plan
from assistant_service.study_agent.dialogue import converse
from assistant_service.study_agent.mcp import Server
from assistant_service.study_agent.reviews import create_review
from assistant_service.study_agent.storage import StudyStore
from assistant_service.study_agent.tutoring import VERSION
from assistant_service.workbuddy_setup import prepare_desktop, workbuddy_status


class WorkBuddyWorkflowTests(unittest.TestCase):
    def setUp(self):
        temp = TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.store = StudyStore(self.root)
        self.course = "并发练习"
        self.quote = "条件变量唤醒后仍须在互斥锁保护下检查谓词。"
        self.eid = self.store.source(origin="handout", course=self.course, title="复习课件", kind="material",
            fingerprint="v1", chunks=[{"text": self.quote, "locator": {"page": 3}}])["id"] + ":0"

    def server(self):
        server = Server(StudyStore(self.root))
        server.handle({"jsonrpc": "2.0", "method": "initialize", "id": 1})
        server.handle({"jsonrpc": "2.0", "method": "notifications/initialized"})
        return server

    def tool(self, server, name, **arguments):
        response = server.handle({"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                                  "params": {"name": name, "arguments": arguments}})
        result = response["result"]
        self.assertFalse(result["isError"], result)
        return json.loads(result["content"][0]["text"])

    def start(self, server, **extra):
        return self.tool(server, "start_practice", course=self.course, topic="条件变量", question="唤醒后为何要检查谓词？",
            expected_answer="另一个线程可能先消费资源，应在锁内循环检查。", request_id="q-1",
            citations=[{"evidence_id": self.eid, "quote": self.quote}], **extra)

    def test_workbuddy_question_web_answer_and_new_session_review_share_one_record(self):
        server = self.server()
        question = self.start(server)
        self.assertNotIn("expected_answer", question)
        self.assertEqual(question["id"], self.start(server)["id"])
        pid = question["id"]
        settings = Settings(self.root)
        classroom = Store(self.root)
        app = create_app(settings, classroom, run_workers=False)
        headers = {"Authorization": "Bearer " + settings.data["token"]}
        try:
            with TestClient(app, headers=headers) as web, patch(
                    "assistant_service.study_agent.api.answer_feedback", side_effect=AssertionError("extra model")):
                self.assertEqual(web.get("/api/study/home").json()["recent_practices"][0]["id"], pid)
                request = {"request_id": "pause-1", "expected_revision": question["session_revision"], "action": "pause"}
                paused = web.post(f"/api/study/practice/{pid}/state", json=request).json()
                self.assertEqual(paused["status"], "paused")
                payload = {"request_id": "answer-1", "expected_revision": 0, "answer": "我只知道要拿到锁。", "rating": 2}
                self.assertEqual(web.post(f"/api/study/practice/{pid}/attempt", json=payload).status_code, 400)
                resumed = web.post(f"/api/study/practice/{pid}/state", json={
                    "action": "resume", "request_id": "resume-1", "expected_revision": paused["session_revision"]}).json()
                self.assertEqual(resumed["status"], "pending")
                self.assertNotIn("expected_answer", resumed)
                answered = web.post(f"/api/study/practice/{pid}/attempt", json=payload).json()
                self.assertEqual(answered["last_attempt"]["answer"], payload["answer"])
                self.assertEqual(len(web.post(f"/api/study/practice/{pid}/attempt", json=payload).json()["attempts"]), 1)
                self.assertEqual(web.post(f"/api/study/practice/{pid}/attempt",
                                         json={**payload, "request_id": "competing"}).status_code, 400)
        finally:
            classroom.db.close()
        restarted = self.server()
        session = self.tool(restarted, "get_learning_session", session_id=question["session_id"])
        self.assertEqual(session["practice"]["id"], pid)
        self.assertEqual(session["practice"]["last_attempt"]["rating"], 2)
        plan = self.tool(restarted, "plan_today_review", minutes=20, course=self.course)
        self.assertEqual(plan["steps"][0]["practice_id"], pid)
        self.assertEqual(len(self.store.list("practice")), 1)
        self.store.source(origin="handout", course=self.course, title="修订版课件", kind="material",
                          fingerprint="v2", chunks=[{"text": self.quote + "新增边界条件。", "locator": {"page": 4}}])
        session = self.tool(restarted, "get_learning_session", session_id=question["session_id"])
        self.assertTrue(session["practice"]["source_stale"])
        self.assertEqual(session["practice"]["last_attempt"]["answer"], payload["answer"])
        plan = self.tool(restarted, "plan_today_review", minutes=20, course=self.course)
        self.assertEqual(plan["steps"], [])

    def test_rated_review_attempt_and_retry_update_schedule_once(self):
        server = self.server()
        review = create_review(self.store, course=self.course, topic="条件变量",
                               citations=[{"evidence_id": self.eid, "quote": self.quote}])
        question = self.start(server, review_id=review["id"])
        args = {"practice_id": question["id"], "answer": "需要重检谓词。", "expected_revision": 0, "request_id": "a-1"}
        first = self.tool(server, "submit_practice_answer", **args)
        self.assertIsNone(first["last_attempt"]["rating"])
        self.assertEqual(self.store.get(review["id"])["cycle"], 0)
        rated = {**args, "request_id": "a-2", "expected_revision": 1, "rating": 3}
        self.tool(server, "submit_practice_answer", **rated)
        self.tool(server, "submit_practice_answer", **rated)
        self.assertEqual(self.store.get(review["id"])["cycle"], 1)
        self.assertEqual(len(self.store.get(question["id"])["attempts"]), 2)

    def test_restart_restores_the_answer_before_the_current_variant(self):
        server = self.server()
        first = self.start(server)
        self.tool(server, "submit_practice_answer", practice_id=first["id"],
                  answer="唤醒后资源一定可用。", request_id="wrong-answer", expected_revision=0)
        session = self.tool(server, "get_learning_session", session_id=first["session_id"])
        variant = self.tool(server, "start_practice", course=self.course, topic="条件变量",
            question="若另一个线程先取走资源，被唤醒的线程应怎样做？", expected_answer="在锁内重检，资源不可用则等待。",
            citations=[{"evidence_id": self.eid, "quote": self.quote}], request_id="variant",
            session_id=session["id"], expected_revision=session["revision"])
        resumed = self.tool(self.server(), "get_learning_session", session_id=session["id"])
        self.assertEqual(resumed["practice"]["id"], variant["id"])
        self.assertNotIn("expected_answer", resumed["practice"])
        self.assertEqual([p["id"] for p in resumed["previous_practices"]], [first["id"]])
        self.assertEqual(resumed["previous_practices"][0]["last_attempt"]["answer"], "唤醒后资源一定可用。")
        self.assertEqual(len(self.store.get(first["id"], "practice")["attempts"]), 1)

    def test_web_variant_reuses_workbuddy_session_and_the_last_actual_answer(self):
        server = self.server()
        question = self.start(server)
        answer = "我会在锁里重新检查队列。"
        self.tool(server, "submit_practice_answer", practice_id=question["id"], answer=answer, rating=3,
                  request_id="good-attempt", expected_revision=0)
        practice = self.store.get(question["id"], "practice")
        self.assertEqual(daily_plan(self.store, 20, self.course, now=practice["due_at"] - 1)["steps"], [])
        self.assertEqual(daily_plan(self.store, 20, self.course, now=practice["due_at"])["steps"][0]["practice_id"],
                         question["id"])
        provider = Mock(spec=["complete"])
        provider.complete.return_value = json.dumps({"action": "finish", "exercise": {
            "question": "另一个消费者取走末尾元素后你该怎么办？", "expected_answer": "再检查，队列空就继续等。",
            "citations": [{"evidence_id": self.eid, "quote": self.quote}]}}, ensure_ascii=False)
        kwargs = {"conversation": "workbuddy-followup", "client_id": "variant-1", "course": self.course,
                  "question": "条件变量，换一个例子", "purpose": "practice", "practice_id": question["id"]}
        turn = converse(self.store, provider, self.root, **kwargs)
        variant = turn["result"]["exercise"]
        context = json.loads(provider.complete.call_args.args[0][-1]["content"])
        self.assertEqual(context["conversation"][-1]["student_answer"], answer)
        self.assertEqual(variant["session_id"], question["session_id"])
        self.assertNotEqual(variant["id"], question["id"])
        self.assertNotIn("expected_answer", variant)
        self.assertEqual(converse(self.store, provider, self.root, **kwargs)["result"]["exercise"]["id"], variant["id"])
        self.assertEqual(provider.complete.call_count, 1)
        second = self.tool(server, "submit_practice_answer", practice_id=variant["id"], answer="在锁内继续等。",
                           rating=3, request_id="good-variant", expected_revision=0)
        self.assertEqual(second["due_at"] - second["last_attempt"]["at"], 4 * 86400)

    @patch("assistant_service.workbuddy_setup.workbuddy_executable", return_value=Path("WorkBuddy.exe"))
    def test_fresh_profile_setup_checks_stdio_and_preserves_other_connectors(self, detect):
        target = self.root / "fake-workbuddy-profile"
        target.mkdir()
        path = target / "mcp.json"
        other = {"url": "https://example.invalid/mcp"}
        path.write_text(json.dumps({"mcpServers": {"other": other}}), encoding="utf-8")
        data = self.root / "empty-data"
        self.assertEqual(workbuddy_status(data, home=target)["state"], "setup_needed")
        prepared = prepare_desktop(data, home=target)
        self.assertEqual(prepared["state"], "configured")
        self.assertFalse(prepared["has_sources"])
        self.assertEqual(prepared["probe"]["version"], VERSION)
        self.assertEqual(prepared["probe"]["tools"], 28)
        config = json.loads(path.read_text("utf-8"))
        self.assertEqual(config["mcpServers"]["other"], other)
        self.assertFalse(prepare_desktop(data, home=target)["config_changed"])
        other_data = self.root / "moved-data"
        self.assertEqual(prepare_desktop(other_data, home=target)["state"], "paths_changed")
        self.assertEqual(json.loads(path.read_text("utf-8")), config)
        self.assertEqual(prepare_desktop(other_data, home=target, repair=True)["state"], "configured")


if __name__ == "__main__":
    unittest.main()
