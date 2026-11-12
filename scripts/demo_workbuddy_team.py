"""Replay the five-role team's public timing-lab fixture over stdio."""
from __future__ import annotations

import argparse
from datetime import datetime, time, timedelta
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from evaluate_workbuddy import CORPUS, connector, seed_demo

from assistant_service.study_agent.planner import TZ
from assistant_service.study_agent.storage import StudyStore, digest


def seed_team_demo(directory: Path):
    corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
    references = seed_demo(directory, corpus)
    store = StudyStore(directory)
    course = corpus["courses"]["dsd"]
    title = "松针-27 实验报告"
    report_day = datetime.now(TZ).date() + timedelta(days=1)
    original_day = report_day + timedelta(days=1)

    def local(day, hour, minute=0):
        return datetime.combine(day, time(hour, minute), TZ).isoformat()

    def notice(key, name, quote, deadline_at, *, kind="material"):
        saved = store.source(origin="team-demo:" + key, course=course, title=name, kind=kind,
                             fingerprint=digest(quote), chunks=[{"text": quote, "locator": {"page": 1}}])
        return {"evidence_id": saved["id"] + ":0", "quote": quote, "deadline_at": deadline_at}

    original = notice("original", "原创演示 · 教师原通知",
                      f"松针-27 实验报告于 {original_day} 22:00（北京时间）截止。", local(original_day, 22))
    official = notice("teacher", "原创演示 · 教师改期通知",
                      f"松针-27 实验报告提前到 {report_day} 20:00（北京时间）截止。", local(report_day, 20))
    classmate = notice("classmate", "原创演示 · 同学转述",
                       f"同学说松针-27 实验报告好像改到 {report_day} 18:00（北京时间）截止。",
                       local(report_day, 18), kind="student_report")
    report = store.save("task", {"course": course, "title": title, "status": "accepted", "source": "student",
                                 "deadline": original_day.isoformat(), "deadline_at": original["deadline_at"],
                                 "estimate_min": 20, "estimate_max": 20, "spent_minutes": 0,
                                 "citations": [{k: original[k] for k in ("evidence_id", "quote")}]}, "team-demo-report")
    other = store.save("task", {"course": course, "title": "预习组合逻辑", "status": "accepted", "source": "student",
                                "estimate_min": 10, "estimate_max": 10, "spent_minutes": 0}, "team-demo-other")
    original_block = {"task_id": report["id"], "course": course, "title": title,
                      "start": local(original_day, 19), "end": local(original_day, 19, 20), "reason": "写实验报告"}
    locked_block = {"task_id": other["id"], "course": course, "title": other["title"], "locked": True,
                    "start": local(report_day, 19, 20), "end": local(report_day, 19, 30), "reason": "学生锁定的预习时段"}
    plan = store.save("plan", {"status": "accepted", "start_date": report_day.isoformat(), "days": 2,
                               "blocks": [locked_block, original_block], "risks": []}, "team-demo-plan")
    return {"data_dir": str(directory), "course": course, "task_id": report["id"], "task_title": title,
            "plan_id": plan["id"], "original_notice": original,
            "official_notice": {**official, "publisher_status": "verified_teacher"},
            "classmate_notice": {**classmate, "publisher_status": "unverified"},
            "original_block": original_block, "locked_block": locked_block,
            "available_windows": [{"start": local(report_day, 19), "end": local(report_day, 19, 30)}],
            "setup_time_citation": references["timing:0"]}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def replay(directory: Path, fixture):
    calls = []
    course = fixture["course"]
    task_id = fixture["task_id"]
    plan_id = fixture["plan_id"]
    store = StudyStore(directory)
    before_task = store.get(task_id, "task")
    before_plan = store.get(plan_id, "plan")
    old_deadline = fixture["original_notice"]["deadline_at"]
    new_deadline = fixture["official_notice"]["deadline_at"]
    original_answer = "满足要求，因为数据在有效时钟沿之前已经稳定。"
    variant_answer = "刚好满足建立时间，因为 8 ns 减去 6 ns 等于 2 ns。"
    practice = {"course": course, "topic": "建立时间", "citations": [fixture["setup_time_citation"]]}
    with connector(directory, calls) as call:
        status = call("study_connection_status")
        first = call("start_practice", **practice, request_id="team-demo-base",
                     question="有效时钟沿在 8 ns，建立时间要求 2 ns。数据在 7 ns 稳定，是否满足要求？",
                     expected_answer="不满足。沿前只稳定了 8 - 7 = 1 ns，少于要求的 2 ns。")
        session_id = first["session_id"]
        require(first["status"] == "pending" and "expected_answer" not in first, "首题应等作答后再显示参考解法")
        answered = call("submit_practice_answer", practice_id=first["id"], answer=original_answer,
                        expected_revision=first["revision"], request_id="team-demo-base-answer")
        require(answered["last_attempt"]["answer"] == original_answer, "未读到学生原答")

        variant = call("start_practice", **practice, session_id=session_id,
                       expected_revision=answered["session_revision"], request_id="team-demo-variant",
                       question="沿仍在 8 ns，建立时间要求仍为 2 ns。如果数据从 6 ns 起稳定，是否满足建立时间？",
                       expected_answer="满足。数据在沿前稳定了 8 - 6 = 2 ns，刚好达到建立时间要求。")
        require(variant["id"] != first["id"] and variant["session_id"] == session_id, "变式没有沿用原学习会话")
        response = call("submit_practice_answer", practice_id=variant["id"], answer=variant_answer,
                        expected_revision=variant["revision"], request_id="team-demo-variant-answer")
        require(response["last_attempt"]["answer"] == variant_answer, "未读到复测作答")

    with connector(directory, calls) as call:
        restored = call("get_learning_session", session_id=session_id)
        require(restored["practice"]["id"] == variant["id"] and
                restored["practice"]["last_attempt"]["answer"] == variant_answer and
                any(item["id"] == first["id"] and item["last_attempt"]["answer"] == original_answer
                    for item in restored.get("previous_practices", [])), "重启后未恢复同一会话的原答与复测")

        def preview(notice):
            return call("prepare_task_deadline_change", task_id=task_id, session_id=session_id,
                        available_windows=fixture["available_windows"], **notice)

        rumor = preview(fixture["classmate_notice"])
        require(rumor["status"] == "needs_review", "同学转述应标为待核对")
        try:
            call("confirm_task_deadline_change", change_id=rumor["id"])
        except RuntimeError as exc:
            if not str(exc).startswith("confirm_task_deadline_change: "):
                raise
        else:
            raise RuntimeError("同学转述可以被直接确认")

        draft = preview(fixture["official_notice"])
        require(draft["status"] == "pending_confirmation" and draft["before"]["deadline_at"] == old_deadline and
                draft["after"]["deadline_at"] == new_deadline, "正式通知未生成正确的改期预览")
        require(store.get(task_id, "task") == before_task and store.get(plan_id, "plan") == before_plan,
                "待核对或待确认阶段改变了任务或计划")
        delta = draft["plan"]
        require(delta["id"] == plan_id and delta["removed_blocks"] == [fixture["original_block"]] and
                delta["unscheduled_minutes"] == 0 and len(delta["added_blocks"]) == 1,
                "改期预览未只移动受影响的报告时段")
        moved = delta["added_blocks"][0]
        require(moved["task_id"] == task_id and moved["start"] == fixture["available_windows"][0]["start"] and
                moved["end"] == fixture["locked_block"]["start"], "报告时段未避开学生锁定的预习")

        # Replay the explicit confirmation that a student would provide in WorkBuddy.
        applied = call("confirm_task_deadline_change", change_id=draft["id"])
        require(applied["status"] == "applied", "模拟学生确认后未应用变更")
        confirmed_task = store.get(task_id, "task")
        confirmed_plan = store.get(plan_id, "plan")
        require(confirmed_task["deadline_at"] == new_deadline and
                len(confirmed_plan["blocks"]) == 2 and
                all(block in confirmed_plan["blocks"] for block in [moved, fixture["locked_block"]]),
                "确认后的任务期限或实际计划与预览不一致")
        retry = call("confirm_task_deadline_change", change_id=draft["id"])
        require(retry == applied and store.get(task_id, "task") == confirmed_task and
                store.get(plan_id, "plan") == confirmed_plan, "重试导致重复写入")

    with connector(directory, calls) as call:
        resumed = call("get_task_deadline_change", task_id=task_id)
        require(resumed["id"] == draft["id"] and resumed["status"] == "applied" and
                resumed["session_id"] == session_id, "新连接未找回同一目标的已确认改期")
        task = next(item for item in call("list_confirmed_study_tasks") if item["id"] == task_id)
        require(task["deadline_at"] == new_deadline, "新连接未读到同一实验的新期限")

    return {"status": "passed", "connector": status["server_version"], "tools": status["tools"],
            "tool_calls": len(calls), "same_session": session_id, "original_answer": original_answer,
            "variant_answer": variant_answer, "deadline_before": old_deadline, "deadline_after": new_deadline,
            "moved_from": fixture["original_block"]["start"], "moved_to": moved["start"],
            "locked_block_preserved": True, "classmate_notice": rumor["status"], "confirmation_retry": "unchanged",
            "scope": "原创固定作答与变式的真实 MCP 协议回放，覆盖新进程续接。WorkBuddy 原生调度另验。"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare", type=Path, metavar="EMPTY_DIR", help="仅初始化独立演示资料，保留待演示的初始状态")
    args = parser.parse_args()
    try:
        if args.prepare:
            result = seed_team_demo(args.prepare.resolve())
        else:
            with TemporaryDirectory(prefix="scut-workbuddy-team-") as temp:
                directory = Path(temp)
                result = replay(directory, seed_team_demo(directory))
    except (RuntimeError, ValueError) as exc:
        parser.exit(1, f"演示检查失败：{exc}\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
