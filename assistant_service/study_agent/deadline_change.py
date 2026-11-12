"""Review and apply one task deadline change against a versioned notice."""
from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta

from .planner import TZ, revise_task_blocks, stamp
from .storage import digest
from .tutoring import verify_study_quotes


CHANGE = "task_deadline_change"
NOTICE_TIME = re.compile(
    r"(?<!\d)(?:(?P<iso>\d{4}-\d{2}-\d{2})[T\s]+|"
    r"(?:(?P<year>\d{4})年\s*)?(?P<month>\d{1,2})月\s*(?P<day>\d{1,2})日\s*)"
    r"(?P<hour>\d{1,2})[:：](?P<minute>\d{2})(?:[:：](?P<second>\d{2}))?"
    r"(?P<offset>Z|[+-]\d{2}:?\d{2})?(?![\d:：+\-]|\s*(?:[AP]\.?M\.?\b|UTC\b|GMT\b))", re.I
)
NAMED_TIME_ZONE = re.compile(
    r"\b(?:(?:UTC|GMT)(?:\b|[+-])|(?:[ECMP][SD]T|[AB]ST|AK[SD]T|CE[ST]T?|EET|JST|KST|IST|A[EW][SD]T|NZ[SD]T)\b|"
    r"(?:Eastern|Central|Mountain|Pacific|Atlantic)\s+(?:(?:Standard|Daylight)\s+)?Time\b)"
    r"|(?:美东|美西|美国东部|美国中部|美国山地|美国太平洋|格林尼治|日本|韩国|英国|中欧)\s*(?:标准|夏令)?时间",
    re.I,
)


def _aware_time(value):
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.utcoffset() is None:
            raise ValueError
        return parsed.astimezone(TZ)
    except (ValueError, OverflowError):
        raise ValueError("时间须为带时区的 ISO 8601 日期和时刻") from None


def _assert_supported_time(quote, deadline, previous_date):
    if NAMED_TIME_ZONE.search(quote):
        raise ValueError("通知含未支持的时区名称，请核对原始时区并提供带数值偏移的原句")
    # A yearless notice can use the existing accepted task's year.
    year = previous_date[:4] if previous_date else ""
    times = set()
    for match in NOTICE_TIME.finditer(quote):
        day = match["iso"]
        if not day:
            notice_year = match["year"] or year
            if not notice_year:
                continue
            day = f'{notice_year}-{int(match["month"]):02d}-{int(match["day"]):02d}'
        hour, minute = int(match["hour"]), int(match["minute"])
        seconds = match["second"] or "00"
        times.add(_aware_time(f'{day}T{hour:02d}:{minute:02d}:{seconds}{match["offset"] or "+08:00"}'))
    if times != {deadline}:
        raise ValueError("请引用只含本次新截止日期与时刻的原句，并核对时区和年份")


def _notice(store, task, evidence_id, quote, deadline, publisher_status):
    checked = verify_study_quotes(store, task["course"], [{"evidence_id": evidence_id, "quote": quote}])
    if not checked["all_matched"]:
        raise ValueError("通知引文不存在、已更新或不属于这门课，请重新取证")
    notice = checked["items"][0]
    if publisher_status == "verified_teacher":
        if store.evidence(evidence_id)["kind"] in {"student_report", "external"}:
            raise ValueError("该来源需要教师或课程官方渠道的原始通知")
        _assert_supported_time(notice["quote"], deadline, task.get("deadline"))
    return notice


def _schedule_snapshot(store, db, task, plan_id):
    accepted = [p for p in store.list("plan", db=db) if p["status"] == "accepted"]
    if plan_id:
        plan = next((p for p in accepted if p["id"] == plan_id), None)
        if plan is None:
            raise ValueError("指定计划尚未确认或已不存在，请重新读取")
    else:
        plan = next((p for p in accepted if any(
            b.get("task_id") == task["id"] for b in p["blocks"])), None)

    occupied = [b for t in store.list("timetable", db=db) if t["status"] == "accepted"
                for b in t.get("busy", [])]
    occupied.extend((plan or {}).get("busy", []))
    occupied.extend(b for p in accepted if not plan or p["id"] != plan["id"]
                    for b in p["blocks"] if b.get("task_id") != task["id"])
    busy = sorted({(stamp(b["start"]), stamp(b["end"])) for b in occupied})
    snapshot = digest([task, plan, [(a.isoformat(), b.isoformat()) for a, b in busy]])
    return plan, busy, snapshot


def _result(change, task):
    public = {k: v for k, v in change.items() if not k.startswith("_") and k not in {"kind", "updated_at"}}
    return {**public, "current_deadline": {k: task.get(k) for k in ("deadline", "deadline_at")},
            "is_current": task.get("deadline_change_id") == change["id"]}


def _latest_change(db, condition, args):
    row = db.execute("SELECT data FROM entities WHERE kind=? AND " + condition
                     + " ORDER BY rowid DESC LIMIT 1", (CHANGE, *args)).fetchone()
    return json.loads(row[0]) if row else None


def prepare_task_deadline_change(store, task_id, evidence_id, quote, deadline_at, publisher_status,
                                 available_windows=(), plan_id="", session_id=""):
    if publisher_status not in {"unverified", "verified_teacher"}:
        raise ValueError("请说明是否已核实为教师通知")
    deadline = _aware_time(deadline_at)
    windows = [(_aware_time(w["start"]), _aware_time(w["end"])) for w in available_windows]
    if any(end <= start for start, end in windows):
        raise ValueError("可用时段的结束时间必须晚于开始时间")
    with store.connect() as db:
        db.execute("BEGIN IMMEDIATE")
        task = store.get(task_id, "task", db=db)
        if task["status"] != "accepted" or task.get("completed"):
            raise ValueError("请选择一项已确认且未完成的任务")
        if session_id and store.get(session_id, "learning_session", db=db)["course"] != task["course"]:
            raise ValueError("学习目标和待改期任务必须属于同一门课")
        notice = _notice(store, task, evidence_id, quote, deadline, publisher_status)
        event = digest([task_id, evidence_id, deadline.isoformat()])
        if publisher_status == "verified_teacher":
            applied = _latest_change(db, "json_extract(data,'$._event')=? AND json_extract(data,'$.status')='applied'",
                                     (event,))
            if applied:
                return _result(applied, task)
        before = {key: task.get(key) for key in ("deadline", "deadline_at", "deadline_evidence")}
        after = {"deadline": deadline.date().isoformat(), "deadline_at": deadline.isoformat()}
        change = {"task_id": task_id, "course": task["course"], "title": task["title"], "session_id": session_id or None,
                  "evidence": notice, "publisher_status": publisher_status, "before": before, "after": after,
                  "status": "needs_review", "plan": None, "_event": event}
        if publisher_status == "verified_teacher":
            plan, busy, snapshot = _schedule_snapshot(store, db, task, plan_id)
            now = datetime.now(TZ)
            keep, diff = revise_task_blocks(task, (plan or {}).get("blocks", []), windows, busy,
                                            now=now, deadline=deadline)
            boundaries = [stamp(b["start"]) for b in diff["removed_blocks"] + diff["added_blocks"]]
            boundaries.extend(stamp(b["start"]) for b in keep if b.get("task_id") == task_id
                              and not (b.get("completed") or b.get("status") == "completed")
                              and now < stamp(b["start"]) < deadline)
            change.update(status="pending_confirmation", plan={"id": (plan or {}).get("id"), **diff},
                          _snapshot=snapshot, _requested_plan_id=plan_id, _kept_blocks=keep,
                          _valid_until=min(boundaries).isoformat() if boundaries else None)
        change_id = digest([CHANGE, change])[:32]
        existing = _latest_change(db, "id=?", (change_id,))
        return _result(existing or store.save(CHANGE, change, change_id, db=db), task)


def _save_revised_plan(store, db, plan, change):
    diff = change["plan"]
    if plan is None and not diff["added_blocks"]:
        return None
    blocks = sorted([*change["_kept_blocks"], *diff["added_blocks"]], key=lambda b: stamp(b["start"]))
    if plan is None:
        plan = {"status": "accepted",
                "assumptions": ["按确认改期时提供的空闲时段安排这一项任务。"]}
    if blocks:
        first = stamp(blocks[0]["start"]).date()
        last = (max(stamp(b["end"]) for b in blocks) - timedelta(microseconds=1)).date()
        if plan.get("start_date"):
            old_start = date.fromisoformat(plan["start_date"])
            first = min(first, old_start)
            last = max(last, old_start + timedelta(days=plan.get("days", 1) - 1))
        plan = {**plan, "start_date": first.isoformat(), "days": (last - first).days + 1}
    task_id = change["task_id"]
    risks = [r for r in plan.get("risks", []) if r.get("task_id") != task_id]
    if diff["unscheduled_minutes"]:
        risks.append({"task_id": task_id, "text": f'截止前尚有 {diff["unscheduled_minutes"]} 分钟排不进去。'})
    if diff["kept_after_deadline"]:
        risks.append({"task_id": task_id, "text": "已锁定或已经开始的时段跨过新截止时间，请自行核对。"})
    saved = store.save("plan", {**plan, "blocks": blocks, "risks": risks}, plan.get("id"), db=db)
    return saved["id"]


def confirm_task_deadline_change(store, change_id):
    """Apply an explicitly confirmed preview once, with no partial writes."""
    with store.connect() as db:
        db.execute("BEGIN IMMEDIATE")
        change = store.get(change_id, CHANGE, db=db)
        task = store.get(change["task_id"], "task", db=db)
        if change["status"] == "applied":
            return _result(change, task)
        if change["status"] != "pending_confirmation":
            raise ValueError("发布者尚未核实，请补充教师原始通知")
        plan, _, snapshot = _schedule_snapshot(store, db, task, change["_requested_plan_id"])
        if snapshot != change["_snapshot"]:
            raise ValueError("任务、计划或课表已变动，请重新生成变更预览")
        if change["_valid_until"] and datetime.now(TZ) >= stamp(change["_valid_until"]):
            raise ValueError("预览中的学习时段已开始，请重新生成变更预览")
        notice = change["evidence"]
        _notice(store, task, notice["evidence_id"], notice["quote"], stamp(change["after"]["deadline_at"]),
                change["publisher_status"])
        plan_id = _save_revised_plan(store, db, plan, change)
        task = store.save("task", {**task, **change["after"], "deadline_evidence": notice,
                                   "deadline_change_id": change_id}, task["id"], db=db)
        applied = {**change, "status": "applied", "plan": {**change["plan"], "id": plan_id}}
        return _result(store.save(CHANGE, applied, change_id, db=db), task)


def get_task_deadline_change(store, task_id):
    with store.connect() as db:
        db.execute("BEGIN")
        task = store.get(task_id, "task", db=db)
        change = _latest_change(db, "json_extract(data,'$.task_id')=?", (task_id,))
        applied_id = task.get("deadline_change_id")
        current = _latest_change(db, "id=?", (applied_id,)) if applied_id else None
    if change is None:
        return {"status": "not_found", "task_id": task_id, "course": task["course"],
                "current_deadline": {k: task.get(k) for k in ("deadline", "deadline_at")}}
    result = _result(change, task)
    if current and current["id"] != change["id"]:
        result["current_change"] = _result(current, task)
    return result
