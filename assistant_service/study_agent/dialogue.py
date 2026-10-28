"""Persistent, channel-neutral dialogue; side effects stay explicit UI actions."""
from __future__ import annotations

import time

from .attachments import prepare_attachments
from .reasoner import run_agent
from .storage import digest


def public_turn(turn, store=None):
    result = dict(turn.get("result", {}))
    if store and result.get("exercise"):
        practice = store.get(result["exercise"]["id"], "practice")
        if practice.get("attempts"):
            result["exercise"] = {**result["exercise"], "expected_answer": practice["expected_answer"],
                                  "last_attempt": practice["attempts"][-1]}
    return {k: v for k, v in turn.items() if k != "result"} | {"result": {
        k: v for k, v in result.items() if k not in {"evidence"}}}


def turns(store, conversation):
    return sorted([t for t in store.list("turn") if t["conversation"] == conversation], key=lambda t: t["created_at"])


def home(store, conversation="main", now=None):
    now = time.time() if now is None else now
    history = turns(store, conversation)
    courses = sorted({s["course"] for s in store.sources()} | {t["course"] for t in store.list("task")})
    reviews = sorted([r for r in store.list("review") if r["status"] == "active"], key=lambda r: r["due_at"])
    tasks = [t for t in store.list("task") if t.get("status") == "accepted" and not t.get("completed")]
    return {"turns": [public_turn(t, store) for t in history[-50:]], "courses": courses,
        "course": next((t["course"] for t in reversed(history) if t.get("course")), ""),
        "reviews": reviews, "due": [r for r in reviews if r["due_at"] <= now],
        "alerts": [a for a in store.list("study_alert") if not a.get("handled")],
        "task_count": len(tasks), "source_count": len(store.sources()),
        "pending_count": sum(p.get("status") == "pending" for p in store.list("proposal"))}


def converse(store, provider, root, *, conversation, client_id, course, question, purpose="auto", attachments=None, review_id=None):
    attachments = attachments or []
    request = digest([conversation, course, question, purpose, attachments, review_id])
    tid = digest(["turn", conversation, client_id])[:32]
    try:
        old = store.get(tid, "turn")
        if old["request"] != request:
            raise ValueError("同一条消息的内容已改变，请重新发送")
        if old["status"] == "ready":
            return public_turn(old)
    except KeyError:
        old = None
    history = turns(store, conversation)
    available = sorted({s["course"] for s in store.sources()}, key=len, reverse=True)
    mentioned = [name for name in available if name in question]
    if len(mentioned) == 1:
        course = mentioned[0]
    if not course and history:
        course = next((t["course"] for t in reversed(history) if t.get("course")), "")
    selected_attachments = [store.get(aid, "attachment") for aid in attachments]
    turn = {"conversation": conversation, "request": request, "course": course, "question": question,
        "purpose": purpose, "review_id": review_id, "status": "running", "created_at": old["created_at"] if old else time.time(),
        "attachments": [{k: a[k] for k in ("id", "name", "image")} for a in selected_attachments]}
    store.save("turn", turn, tid)
    if not course:
        result = {"reply": "先告诉我这是哪门课就好。你发来的问题和附件已经留在这里，选好后我接着看。",
                  "choose_course": available, "claims": [], "proposals": [], "uncertainties": [], "status": "needs_course"}
        return public_turn(store.save("turn", {**turn, "status": "ready", "result": result}, tid))
    try:
        focus, images = prepare_attachments(store, provider, root, attachments, course, question)
        if any(text in question for text in ("老师说", "老师要求", "记住", "作业要求", "考勤要求")):
            source = store.source(origin="student-message:" + tid, course=course, title="你补充的课堂信息", kind="student_report",
                                  fingerprint=digest(question), chunks=[{"text": question, "locator": {"message": tid}}])
            focus.insert(0, store.evidence(source["id"] + ":0"))
        related = [t for t in history if t.get("course") == course and t.get("status") == "ready"][-6:]
        previous = [{"question": t["question"], "answer": "\n".join(c["text"] for c in t.get("result", {}).get("claims", []))[:1600],
                     "next_question": t.get("result", {}).get("next_question", "")} for t in related]
        # Preserve references across short follow-ups such as “为什么” or “换个例子”.
        for t in related[-2:]:
            for claim in t.get("result", {}).get("claims", [])[:3]:
                for c in claim["citations"][:1]:
                    item = store.evidence(c["evidence_id"])
                    if item["course"] == course and item["active"]:
                        focus.append(item)
        if review_id:
            review = store.get(review_id, "review")
            if review["course"] != course:
                raise ValueError("这条复习属于另一门课，请先切换课程")
            for c in review.get("citations", [])[:4]:
                item = store.evidence(c["evidence_id"])
                if item["active"]:
                    focus.insert(0, item)
        if purpose == "auto":
            purpose = "practice" if any(s in question for s in ("出道题", "出一道", "考考我", "检验一下")) else (
                "connect" if any(s in question for s in ("串联", "联系", "关联", "前置知识")) else (
                "summary" if any(s in question for s in ("深入总结", "完整总结", "梳理整章")) else "ask"))
        result = run_agent(store, provider, course=course, question=question, purpose=purpose,
                           history=previous, focus=focus, max_steps=2 if images else 3)
        result["input_images"] = images
        return public_turn(store.save("turn", {**turn, "purpose": purpose, "status": "ready", "result": result}, tid))
    except Exception as exc:
        store.save("turn", {**turn, "status": "failed", "error": str(exc)[:240]}, tid)
        raise
