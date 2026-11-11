"""Run the public course fixtures through the real stdio connector."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import json
import math
from pathlib import Path
from queue import Empty, Queue
import statistics
import subprocess
import sys
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from assistant_service.study_agent.concepts import register_concept
from assistant_service.study_agent.knowledge import set_policy
from assistant_service.study_agent.storage import StudyStore, digest

CORPUS = ROOT / "workbuddy/demo/corpus.json"


def seed_demo(directory, corpus):
    if directory.exists() and any(directory.iterdir()):
        raise ValueError("演示资料必须放在一个空目录中")
    store = StudyStore(directory)
    references = {}
    for source in corpus["sources"]:
        key = source["key"]
        chunks = []
        for part in source["chunks"]:
            text = part["text"]
            if "basis" in part:
                locator = {"session_id": key, "time_basis": part["basis"],
                           "start": part["start"], "end": part["end"],
                           "spans": [{"offset": 0, "length": len(text), "start": part["start"], "end": part["end"]}]}
            else:
                locator = {"page": part["page"]}
            chunks.append({"text": text, "locator": locator})
        saved = store.source(origin="demo:" + source.get("origin", key), course=corpus["courses"][source["course"]],
                             title=source["title"], kind=source["kind"], fingerprint=digest(chunks),
                             chunks=chunks, meta=source.get("meta"))
        for n, chunk in enumerate(chunks):
            references[f"{key}:{n}"] = {"evidence_id": f"{saved['id']}:{n}", "quote": chunk["text"]}
        if source.get("excluded"):
            set_policy(store, saved["id"], role="other", excluded=True)
    for entry in corpus["aliases"]:
        register_concept(store, course=corpus["courses"][entry["course"]], canonical=entry["canonical"],
                         zh=entry["zh"], aliases=entry["aliases"],
                         evidence_ids=[references[ref]["evidence_id"] for ref in entry["refs"]])
    return references


@contextmanager
def connector(data, metrics):
    with subprocess.Popen([sys.executable, str(ROOT / "scripts/study_mcp.py"), "--data-dir", str(data)],
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                          encoding="utf-8", cwd=data) as child:
        lines = Queue()

        def read():
            for line in child.stdout:
                lines.put(line)
            lines.put(None)

        threading.Thread(target=read, daemon=True).start()
        request_number = 0

        def exchange(method, params=None, notification=False):
            nonlocal request_number
            request_number += 1
            request = {"jsonrpc": "2.0", "method": method, "params": params or {}}
            if not notification:
                request["id"] = request_number
            start = time.perf_counter()
            child.stdin.write(json.dumps(request, ensure_ascii=False) + "\n")
            child.stdin.flush()
            if notification:
                return None
            try:
                line = lines.get(timeout=20)
            except Empty as exc:
                raise RuntimeError(f"MCP response timed out for {method}") from exc
            if line is None:
                raise RuntimeError(f"MCP exited during {method}")
            response = json.loads(line)
            if response.get("id") != request_number or "error" in response:
                raise RuntimeError(f"MCP rejected {method}: {response.get('error', {}).get('code')}")
            if method == "tools/call":
                metrics.append({"tool": params["name"], "ms": round((time.perf_counter() - start) * 1000, 2),
                                "reply_bytes": len(line.encode("utf-8"))})
            return response["result"]

        def call(name, **arguments):
            result = exchange("tools/call", {"name": name, "arguments": arguments})
            if result["isError"]:
                raise RuntimeError(f"{name}: {result['content'][0]['text']}")
            return json.loads(result["content"][0]["text"])

        try:
            exchange("initialize", {"protocolVersion": "2025-03-26"})
            exchange("notifications/initialized", notification=True)
            yield call
        finally:
            child.stdin.close()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


def evaluate(data, corpus, references):
    os_course, dsd_course = (corpus["courses"][code] for code in ("os", "dsd"))
    checks, results, calls = {}, [], []
    labels = {value["evidence_id"]: key for key, value in references.items()}
    forbidden = {"timing_old:0", "excluded:0"}
    with connector(data, calls) as call:
        version = call("study_connection_status")
        for case in corpus["queries"]:
            course = corpus["courses"].get(case["course"], "")
            hits = call("search_knowledge_base", query=case["query"], course=course, limit=8)["items"]
            actual = [labels[item["id"]] for item in hits]
            expected = set(case["expected"])
            acceptable = not (set(actual) & forbidden) and all(not course or item["course"] == course for item in hits)
            passed = acceptable and (expected <= set(actual) if expected else not actual)
            if case.get("first"):
                passed = passed and actual[:1] == [case["first"]]
            results.append({"id": case["id"], "expected": case["expected"], "returned": actual,
                            "recall_at_3": len(expected.intersection(actual[:3])) / len(expected) if expected else None,
                            "recall_at_8": len(expected.intersection(actual)) / len(expected) if expected else None,
                            "pass": passed})

        found = call("find_classroom_mentions", course=os_course, query="老师在哪讲过条件变量？")["items"]
        video = next((hit for hit in found if hit["time_basis"] == "video"), {})
        capture = next((hit for hit in found if hit["time_basis"] == "capture"), {})
        checks["video_time_and_link"] = video.get("start") == 92 and video.get("playback_url", "").endswith("note_play=92")
        checks["capture_not_replay"] = capture.get("start") == 17 and capture.get("playback_url") == ""
        checks["conflicting_transcripts_visible"] = any("必须重新检查" in hit["quote"] for hit in found) and any(
            "不用重新检查" in hit["quote"] for hit in found)
        family = call("prepare_evidence_comparison", course=os_course, question="这两段字幕是否独立？",
                      evidence_ids=[references[key]["evidence_id"] for key in ("sync_video:0", "sync_asr:0")])
        checks["parallel_transcripts_share_family"] = family["independent_families"] == 1
        supported = {**references["cv:1"], "quote": "用 while 循环在唤醒后重新检查谓词。"}
        citation_cases = [supported, {**supported, "quote": "只要醒来就不用再检查。"},
                          references["wrong_course:0"], references["excluded:0"]]
        validated = call("verify_study_quotes", course=os_course, citations=citation_cases)["items"]
        rejected = [item["status"] for item in validated[1:]]
        checks["quote_with_page"] = validated[0]["status"] == "matched" and validated[0]["locator"]["page"] == 4
        checks["unsupported_quotes_rejected"] = rejected == ["quote_not_found", "unavailable", "unavailable"]
        stale = call("verify_study_quotes", course=dsd_course, citations=[references["timing_old:0"]])["items"][0]
        checks["stale_quote_rejected"] = stale["status"] == "unavailable"
        quiz = call("prepare_quiz", course=os_course, topic="while 循环", count=3, delivery="worksheet")
        checks["worksheet_slots_do_not_repeat"] = (
            0 < len(quiz["slots"]) < quiz["requested"] and quiz["status"] == "partial"
            and len({tuple(slot["evidence_ids"]) for slot in quiz["slots"]}) == len(quiz["slots"]))
        absent = call("prepare_quiz", course=dsd_course, topic="Frobenius eigenvalue", count=2)
        checks["quiz_with_no_evidence"] = absent["status"] == "needs_sources" and not absent["slots"]
        correct = call("verify_boolean_design", variables=["a", "b"], original="not (a and b)", candidate="not a or not b")
        incorrect = call("verify_boolean_design", variables=["a", "b"], original="not (a and b)", candidate="not a and not b")
        checks["reference_boolean_answer"] = correct["equivalent"] and not incorrect["equivalent"] and bool(incorrect["counterexample"])
        question = call("start_practice", course=os_course, topic="条件变量", question="唤醒后共享队列仍为空，接下来如何处理？",
                        expected_answer="在互斥锁保护下循环检查谓词。队列仍为空就继续等待。",
                        citations=[supported], request_id="demo-practice-1")
        checks["pending_answer_hidden"] = "expected_answer" not in question and question["status"] == "pending"

    with connector(data, calls) as call:
        restored = call("get_learning_session", session_id=question["session_id"])["practice"]
        checks["resume_after_connector_restart"] = restored["id"] == question["id"] and restored["question"] == question["question"]
        answer = {"practice_id": restored["id"], "answer": "我知道要拿到锁，但不确定什么时候继续等待。",
                  "rating": 2, "request_id": "demo-answer-1", "expected_revision": restored["revision"]}
        first = call("submit_practice_answer", **answer)
        retry = call("submit_practice_answer", **answer)
        checks["answer_retry_only_once"] = first["revision"] == retry["revision"] == 1 and first["last_attempt"]["answer"] == answer["answer"]
        plan = call("plan_today_review", minutes=20, course=os_course)
        checks["same_question_in_daily_plan"] = any(step.get("practice_id") == question["id"] for step in plan["steps"])
    recalls = [row for row in results if row["recall_at_8"] is not None]
    latencies = sorted(item["ms"] for item in calls)
    return {
        "format": "scut-workbuddy-eval-v1", "connector": version["server_version"], "tools": version["tools"],
        "fixture_sources": len(corpus["sources"]), "model_calls": 0, "tool_calls": len(calls),
        "recall_at_3": round(statistics.mean(row["recall_at_3"] for row in recalls), 3),
        "recall_at_8": round(statistics.mean(row["recall_at_8"] for row in recalls), 3),
        "negative_quote_cases": len(rejected) + 1, "unsupported_quotes_accepted": rejected.count("matched") + (stale["status"] == "matched"),
        "latency_ms": {"median": statistics.median(latencies), "p95": latencies[math.ceil(.95 * len(latencies)) - 1]},
        "reply_bytes": sum(item["reply_bytes"] for item in calls),
        "queries": results, "checks": checks, "calls": calls,
        "passed": all(row["pass"] for row in results) and all(checks.values()),
        "scope": "固定原创夹具，经真实 MCP 进程运行。延迟为本机工具往返。模型理解和 WorkBuddy 界面另验。"
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "dist/workbuddy-eval.json")
    parser.add_argument("--keep-data", type=Path, help="保留一份独立的演示索引，目录必须为空")
    args = parser.parse_args()
    corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory(prefix="scut-workbuddy-demo-") as temp:
        data = (args.keep_data or Path(temp)).resolve()
        report = evaluate(data, corpus, seed_demo(data, corpus))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k not in {"queries", "checks", "calls"}}, ensure_ascii=False))
    if not report["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
