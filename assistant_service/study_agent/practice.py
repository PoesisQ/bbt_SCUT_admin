"""Practice state shared by the web and WorkBuddy. Model calls stay with the caller."""
from __future__ import annotations

import json
import time
import uuid

from .concepts import topic_key
from .planner import review_interval
from .reviews import update_review_in_transaction
from .storage import digest
from .tutoring import record_progress, verify_study_quotes


def current_sources(store, course, citations):
    if not citations:
        return False
    for citation in citations:
        try:
            evidence = store.evidence(citation["evidence_id"])
        except (KeyError, TypeError):
            return False
        if evidence["course"] != course or not evidence["active"] or evidence.get("policy", {}).get("excluded"):
            return False
    return True


def practice_view(store, practice):
    attempts = practice.get("attempts", [])
    citations = practice.get("citations", [])
    session = store.get(practice["session_id"], "learning_session") if practice.get("session_id") else None
    value = {k: practice.get(k) for k in ("id", "course", "question", "citations", "session_id", "review_id", "due_at")}
    value.update(topic=practice.get("topic") or practice["question"], citations=citations, revision=len(attempts),
                 status="paused" if session and session["status"] == "paused" else "answered" if attempts else "pending",
                 session_revision=session["revision"] if session else None,
                 is_current=not session or session.get("practice_id") == practice["id"],
                 current_practice_id=session.get("practice_id") if session else None,
                 source_stale=bool(citations) and not current_sources(store, practice["course"], citations))
    if attempts:
        value.update(expected_answer=practice["expected_answer"], last_attempt=attempts[-1])
    return value


def practice_for_request(store, request_id):
    try:
        return practice_view(store, store.get(digest(["shared-practice", request_id])[:32], "practice"))
    except KeyError:
        return None


def recent_practices(store):
    """Only the current question in recent sessions belongs in the resume picker."""
    with store.connect() as db:
        rows = db.execute("""
            SELECT p.data FROM entities s JOIN entities p ON p.id=json_extract(s.data,'$.practice_id')
            WHERE s.kind='learning_session' AND p.kind='practice'
            ORDER BY json_extract(s.data,'$.updated_at') DESC, s.id LIMIT 3
        """).fetchall()
    return [practice_view(store, json.loads(row[0])) for row in rows]


def _new_session(store, db, sid, course, topic, pid, now):
    return store.save("learning_session", {"course": course, "goal": topic[:500], "language": "bilingual",
        "teaching_mode": "interactive", "revision": 0, "status": "active", "recent_steps": [],
        "practice_id": pid, "created_at": now, "request_signature": ""}, sid, db=db)


def _check_review(store, db, review_id, course):
    review = store.get(review_id, "review", db=db)
    if review["course"] != course:
        raise ValueError("这次作答与复习课程不匹配")
    if review["status"] == "paused":
        raise ValueError("这项间隔复习已暂停，请先恢复复习")
    return review


def prior_ratings(store, db, item):
    """A new question on the same topic inherits recent valid recall history."""
    history = list(item.get("attempts", []))
    if item.get("topic_key"):
        rows = db.execute("""SELECT data FROM entities WHERE kind='practice' AND id<>?
            AND json_extract(data,'$.course')=? AND json_extract(data,'$.topic_key')=?
            ORDER BY json_extract(data,'$.updated_at') DESC LIMIT 6""",
            (item["id"], item["course"], item["topic_key"])).fetchall()
        for row in rows:
            prior = json.loads(row[0])
            if prior.get("attempts") and current_sources(store, item["course"], prior["citations"]):
                history.extend(prior["attempts"])
    return sorted((a for a in history if a.get("rating") is not None), key=lambda a: a["at"])[-5:]


def start_practice(store, course, topic, question, expected_answer, citations, request_id,
                   session_id="", expected_revision=None, review_id="", *, origin="workbuddy"):
    course, topic, question, expected_answer = [s.strip() for s in (course, topic, question, expected_answer)]
    if not all((course, topic, question, expected_answer, request_id, citations)):
        raise ValueError("请提供课程、主题、题目、参考答案和原文引文")
    pid = digest(["shared-practice", request_id])[:32]
    sid = session_id or "lesson-" + digest(["practice-session", pid])[:32]
    signature = digest([course, topic, question, expected_answer, citations, session_id, review_id])
    with store.connect() as db:
        db.execute("BEGIN IMMEDIATE")
        try:
            item = store.get(pid, "practice", db=db)
        except KeyError:
            item = None
        if item:
            if item.get("request_signature") != signature:
                raise ValueError("同一请求的题目已改变，请使用新的请求 ID")
        else:
            if review_id:
                _check_review(store, db, review_id, course)
            checked = verify_study_quotes(store, course, citations)
            if not checked["all_matched"]:
                raise ValueError("题目引文缺失、已失效或不属于这门课，请重新取证")
            if session_id:
                session = store.get(sid, "learning_session", db=db)
                if session["course"] != course or session["status"] != "active":
                    raise ValueError("请先选中这门课的有效学习会话")
                if session["revision"] != expected_revision:
                    raise ValueError("学习会话已更新，请重新读取后继续")
                if session.get("practice_id"):
                    previous = store.get(session["practice_id"], "practice", db=db)
                    if not previous["attempts"] and current_sources(store, course, previous["citations"]):
                        raise ValueError("本会话已有待作答的题。可以继续这道题，或另建一个主题会话")
                store.save("learning_session", {**session, "practice_id": pid,
                           "teaching_mode": "interactive", "revision": session["revision"] + 1}, sid, db=db)
            else:
                _new_session(store, db, sid, course, topic, pid, time.time())
            citations = [{k: row[k] for k in ("evidence_id", "quote", "location", "locator")} for row in checked["items"]]
            item = store.save("practice", {"course": course, "topic": topic, "topic_key": topic_key(store, course, topic),
                              "question": question, "expected_answer": expected_answer, "citations": citations,
                              "session_id": sid, "review_id": review_id, "attempts": [], "due_at": time.time(), "origin": origin,
                              "request_signature": signature}, pid, db=db)
    return practice_view(store, item)


def submit_attempt(store, practice_id, answer, rating=None, review_id=None, request_id="", expected_revision=None,
                   *, feedback=None):
    answer = answer.strip()
    if not answer or rating is not None and (type(rating) is not int or not 1 <= rating <= 4):
        raise ValueError("请填写作答，自评可留空或选 1 至 4")
    request_id = request_id or uuid.uuid4().hex
    review = None
    with store.connect() as db:
        db.execute("BEGIN IMMEDIATE")
        item = store.get(practice_id, "practice", db=db)
        attempts = item.get("attempts", [])
        if item.get("review_id") and review_id and review_id != item["review_id"]:
            raise ValueError("这道题已关联另一条复习记录")
        rid = item.get("review_id") or review_id
        retry = next((a for a in attempts if a.get("request_id") == request_id), None)
        if retry:
            if (retry["answer"], retry.get("rating"), retry.get("review_id")) != (answer, rating, rid):
                raise ValueError("同一请求的作答已改变，请重新提交")
            if retry.get("review_completed"):
                review = store.get(rid, "review", db=db)
        else:
            if expected_revision is not None and expected_revision != len(attempts):
                raise ValueError("这道题的作答已更新，请重新读取后继续")
            if item.get("citations") and not current_sources(store, item["course"], item["citations"]):
                raise ValueError("题目引用的来源已变更。请重新取证后出题")
            sid = item.get("session_id")
            if sid:
                session = store.get(sid, "learning_session", db=db)
                if session["status"] != "active" or session.get("practice_id") != practice_id:
                    raise ValueError("请先恢复这道题对应的学习会话")
            else:
                sid = "lesson-" + digest(["practice-session", practice_id])[:32]
                session = _new_session(store, db, sid, item["course"], item.get("topic") or item["question"], practice_id, time.time())
            if rid:
                _check_review(store, db, rid, item["course"])
            now = time.time()
            completes_review = bool(rid and rating is not None and not any(a.get("review_completed") for a in attempts))
            attempt = {"answer": answer, "rating": rating, "feedback": feedback, "at": now,
                       "request_id": request_id, "review_id": rid, "review_completed": completes_review}
            if rating is not None:
                item["due_at"] = now + review_interval(prior_ratings(store, db, item), rating) * 86400
            item = store.save("practice", {**item, "session_id": sid, "review_id": rid,
                              "attempts": [*attempts, attempt], "assessment": "学生作答与可选自评"}, practice_id, db=db)
            store.save("learning_session", {**session, "revision": session["revision"] + 1}, sid, db=db)
            if attempt["review_completed"]:
                review = update_review_in_transaction(store, db, rid, action="complete", rating=rating, feedback=feedback, now=now)
    result = practice_view(store, item)
    if review:
        result["review"] = {key: review[key] for key in ("id", "due_at", "status", "cycle")}
    return result


def change_practice_state(store, practice_id, action, request_id, expected_revision):
    item = store.get(practice_id, "practice")
    if action not in {"pause", "resume"} or not item.get("session_id"):
        raise ValueError("这道题没有可暂停或恢复的会话")
    record_progress(store, item["session_id"], request_id, expected_revision,
                    (item.get("topic") or item["question"])[:300], [], action=action, practice_id=practice_id)
    return practice_view(store, item)
