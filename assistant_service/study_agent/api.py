from __future__ import annotations

import threading
import time
from datetime import date
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import Field, field_validator, model_validator

from . import ingest
from .planner import calendar, make_plan, review_interval, stamp
from .reasoner import Provider, Strict, run_agent
from .storage import StudyStore, digest
from .timetable import expand_timetable, extract_timetable


class Library(Strict):
    root: str = Field(min_length=3, max_length=1000)
    course: str = Field(min_length=1, max_length=160)


class ImportFiles(Strict):
    library_id: str = Field(max_length=80)
    files: list[str] = Field(min_length=1, max_length=30)


class Ask(Strict):
    course: str = Field(min_length=1, max_length=160)
    question: str = Field(min_length=2, max_length=1200)
    purpose: Literal["ask", "verify", "requirements", "practice"] = "ask"


class Decide(Strict):
    status: Literal["accepted", "rejected"]
    deadline: date | None = None
    estimate_min: int | None = Field(default=None, ge=5, le=6000)
    estimate_max: int | None = Field(default=None, ge=5, le=12000)
    difficulty: int = Field(default=3, ge=1, le=5)

    @model_validator(mode="after")
    def bounds(self):
        if self.estimate_min is not None and self.estimate_max is not None and self.estimate_max < self.estimate_min:
            raise ValueError("耗时上限不能低于下限")
        return self


class Task(Strict):
    course: str = Field(min_length=1, max_length=160)
    title: str = Field(min_length=1, max_length=160)
    detail: str = Field(default="", max_length=2000)
    deadline: date | None = None
    estimate_min: int = Field(default=30, ge=5, le=6000)
    estimate_max: int = Field(default=60, ge=5, le=12000)
    difficulty: int = Field(default=3, ge=1, le=5)

    @model_validator(mode="after")
    def bounds(self):
        if self.estimate_max < self.estimate_min:
            raise ValueError("耗时上限不能低于下限")
        return self


class Progress(Strict):
    spent_minutes: int = Field(ge=0, le=12000)
    completed: bool = False


class Requirement(Strict):
    course: str = Field(min_length=1, max_length=160)
    detail: str = Field(min_length=2, max_length=2000)


class Busy(Strict):
    start: str = Field(max_length=40)
    end: str = Field(max_length=40)

    @model_validator(mode="after")
    def times(self):
        if not all("T" in v and ("+" in v[10:] or v.endswith("Z")) for v in (self.start, self.end)):
            raise ValueError("时间必须包含时区")
        if stamp(self.end) <= stamp(self.start):
            raise ValueError("结束时间必须晚于开始时间")
        return self


class Plan(Strict):
    start: date
    days: int = Field(default=7, ge=1, le=30)
    daily_minutes: int = Field(default=90, ge=15, le=240)
    start_hour: int = Field(default=19, ge=6, le=20)
    busy: list[Busy] = Field(default_factory=list, max_length=500)


class Attempt(Strict):
    answer: str = Field(min_length=1, max_length=3000)
    rating: int = Field(ge=1, le=4)


class Visual(Strict):
    url: str = Field(max_length=1600)
    seconds: int = Field(ge=0, le=172800)


class Visuals(Strict):
    course: str = Field(min_length=1, max_length=160)
    course_url: str = Field(max_length=2000)
    title: str = Field(max_length=200)
    items: list[Visual] = Field(min_length=1, max_length=600)


class TimetableFile(Strict):
    library_id: str = Field(max_length=80)
    file: str = Field(max_length=1000)


class Period(Strict):
    number: int = Field(ge=1, le=16)
    start: str = Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    end: str = Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")


class ClassSlot(Strict):
    course: str = Field(min_length=1, max_length=160)
    weekday: int = Field(ge=0, le=6)
    first_period: int = Field(ge=1, le=16)
    last_period: int = Field(ge=1, le=16)
    weeks: list[int] = Field(min_length=1, max_length=30)
    weeks_text: str = Field(default="", max_length=200)
    source_page: int = Field(default=0, ge=0, le=10)

    @field_validator("weeks")
    @classmethod
    def weeks_valid(cls, value):
        if any(w < 1 or w > 30 for w in value):
            raise ValueError("周次须在 1–30 之间")
        return sorted(set(value))


class TimetableConfirm(Strict):
    semester_monday: date
    periods: list[Period] = Field(min_length=1, max_length=16)
    candidates: list[ClassSlot] = Field(min_length=1, max_length=100)


def router(settings, classroom_store):
    study, provider = StudyStore(settings.root), Provider(settings)
    api = APIRouter(prefix="/api/study")
    model_gate = threading.BoundedSemaphore(1)

    @api.get("/overview")
    def overview():
        sources = study.sources()
        tasks = study.list("task")
        courses = sorted({s["course"] for s in sources} | {t["course"] for t in tasks})
        practices = [{k: v for k, v in p.items() if k not in {"expected_answer", "attempts"}} for p in study.list("practice")]
        return {"courses": courses, "sources": sources, "tasks": tasks, "proposals": study.list("proposal"),
                "practice": practices, "plans": study.list("plan")[:5], "libraries": study.list("library"),
                "timetables": study.list("timetable"), "provider": provider.public(),
                "onboarding": "先添加一门课的资料或同步已有课堂记录" if not sources else "选择一门课，问一个今天最想弄明白的问题"}

    @api.post("/libraries")
    def add_library(body: Library):
        root = Path(body.root).expanduser().resolve()
        preview = ingest.inventory(root)
        library = study.save("library", {"root": str(root), "course": body.course}, digest([str(root), body.course])[:32])
        return {**library, **preview}

    @api.post("/import")
    def import_files(body: ImportFiles):
        library = study.get(body.library_id, "library")
        result = []
        for relative in body.files:
            try:
                value = ingest.import_file(study, Path(library["root"]), relative, library["course"])
                result.append({"file": relative, **value, "status": "ready"})
            except (ValueError, OSError, UnicodeError, EOFError) as exc:
                result.append({"file": relative, "status": "failed", "error": str(exc)[:200]})
        return {"items": result}

    @api.post("/sync")
    def sync():
        return ingest.sync_sessions(study, classroom_store.records())

    @api.get("/search")
    def search(course: str, q: str):
        if not course or len(q) > 1200:
            raise ValueError("请选择课程并缩短检索内容")
        return {"items": study.search(q, course)}

    @api.get("/evidence/{eid}")
    def evidence(eid: str):
        return study.evidence(eid)

    @api.post("/run")
    def run(body: Ask):
        if not model_gate.acquire(blocking=False):
            raise HTTPException(409, "正在整理上一条问题，请稍候")
        try:
            ingest.sync_sessions(study, classroom_store.records())
            return run_agent(study, provider, **body.model_dump())
        finally:
            model_gate.release()

    @api.post("/proposals/{pid}")
    def decide(pid: str, body: Decide):
        proposal = study.get(pid, "proposal")
        if proposal["proposal_kind"] == "task" and body.status == "accepted" and (body.estimate_min is None or body.estimate_max is None):
            raise ValueError("请先估计任务用时；较大的项目可以先拆成一个具体步骤")
        # Only this explicit user action turns model suggestions into tasks/memory.
        value = study.save("proposal", {**proposal, "status": body.status}, pid)
        if proposal["proposal_kind"] == "task":
            study.save("task", {**proposal, **body.model_dump(mode="json"), "source": "confirmed_proposal", "completed": False}, pid)
        return value

    @api.post("/tasks")
    def task(body: Task):
        return study.save("task", {**body.model_dump(mode="json"), "status": "accepted", "source": "student", "completed": False})

    @api.post("/requirements")
    def requirement(body: Requirement):
        value = study.save("proposal", {"course": body.course, "title": "学生补充的课程要求", "detail": body.detail,
                                        "proposal_kind": "requirement", "status": "accepted", "source": "student_report", "citations": []})
        study.source(origin="requirement:" + value["id"], course=body.course, title="学生补充的课程要求", kind="student_report",
                     fingerprint=digest(body.detail), chunks=[{"text": body.detail, "locator": {"section": 1}}])
        return value

    @api.post("/tasks/{tid}/progress")
    def progress(tid: str, body: Progress):
        return study.save("task", {**study.get(tid, "task"), **body.model_dump()}, tid)

    @api.post("/plans")
    def plan(body: Plan):
        busy = [b.model_dump() for b in body.busy]
        for timetable in study.list("timetable"):
            if timetable.get("status") == "accepted":
                busy += timetable.get("busy", [])
        value = make_plan(study.list("task"), **body.model_dump(exclude={"busy"}), busy=busy)
        return study.save("plan", value)

    @api.post("/plans/{pid}/confirm")
    def confirm_plan(pid: str):
        return study.save("plan", {**study.get(pid, "plan"), "status": "accepted"}, pid)

    @api.get("/plans/{pid}/calendar")
    def export_calendar(pid: str):
        return Response(calendar(study.get(pid, "plan")), media_type="text/calendar; charset=utf-8",
                        headers={"Content-Disposition": 'attachment; filename="study-plan.ics"'})

    @api.post("/practice/{pid}/attempt")
    def practice(pid: str, body: Attempt):
        item = study.get(pid, "practice")
        days = review_interval(item["attempts"], body.rating)
        item["attempts"].append({**body.model_dump(), "at": time.time()})
        item.update(due_at=time.time() + days * 86400, assessment="学生自评，尚非客观掌握度")
        return study.save("practice", item, pid)

    @api.post("/visuals")
    def visuals(body: Visuals):
        items = ingest.validate_visuals(body.course_url, [x.model_dump() for x in body.items])
        return study.save("visual", {**body.model_dump(), "items": items, "status": "references_only", "ocr_status": "not_run"}, digest([body.course_url, items])[:32])

    @api.get("/visuals")
    def list_visuals():
        return study.list("visual")

    @api.post("/timetable/preview")
    def timetable(body: TimetableFile):
        library = study.get(body.library_id, "library")
        path = ingest.safe_file(Path(library["root"]), Path(library["root"]) / body.file)
        if path.suffix.lower() != ".pdf":
            raise ValueError("请使用学校导出的 PDF 课表")
        value = extract_timetable(path)
        return study.save("timetable", {**value, "source": str(path)})

    @api.post("/timetable/{tid}/confirm")
    def confirm_timetable(tid: str, body: TimetableConfirm):
        original = study.get(tid, "timetable")
        expanded = expand_timetable([c.model_dump() for c in body.candidates], body.semester_monday,
                                    [p.model_dump() for p in body.periods])
        # Replaces the confirmed schedule; multiple imported snapshots must not accumulate busy times.
        for old in study.list("timetable"):
            if old["id"] != tid and old.get("status") == "accepted":
                study.save("timetable", {**old, "status": "superseded"}, old["id"])
        return study.save("timetable", {**original, **body.model_dump(mode="json"), **expanded, "status": "accepted"}, tid)

    return api
