from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .storage import digest


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Citation(Strict):
    evidence_id: str = Field(max_length=80)
    quote: str = Field(min_length=4, max_length=500)


class Claim(Strict):
    text: str = Field(min_length=1, max_length=1200)
    citations: list[Citation] = Field(min_length=1, max_length=5)


class Proposal(Strict):
    kind: Literal["task", "correction", "requirement"]
    title: str = Field(min_length=1, max_length=150)
    detail: str = Field(max_length=1400)
    citations: list[Citation] = Field(min_length=1, max_length=5)
    due_text: str = Field(default="", max_length=150)


class Exercise(Strict):
    question: str = Field(min_length=1, max_length=1200)
    expected_answer: str = Field(min_length=1, max_length=1800)
    citations: list[Citation] = Field(min_length=1, max_length=5)


class Connection(Strict):
    concept_a: str = Field(min_length=1, max_length=120)
    concept_b: str = Field(min_length=1, max_length=120)
    relationship: str = Field(min_length=1, max_length=1000)
    citations: list[Citation] = Field(min_length=2, max_length=5)


class Final(Strict):
    action: Literal["finish"]
    claims: list[Claim] = Field(default_factory=list, max_length=10)
    uncertainties: list[str] = Field(default_factory=list, max_length=8)
    proposals: list[Proposal] = Field(default_factory=list, max_length=6)
    exercise: Exercise | None = None
    reply: str = Field(default="", max_length=1000)
    next_question: str = Field(default="", max_length=200)
    connections: list[Connection] = Field(default_factory=list, max_length=4)


class Search(Strict):
    action: Literal["search"]
    query: str = Field(min_length=1, max_length=200)


class Read(Strict):
    action: Literal["read"]
    evidence_id: str = Field(max_length=80)


class Provider:
    """Small OpenAI-compatible transport; provider secrets never enter prompts or traces."""

    def __init__(self, settings):
        self.settings = settings

    def config(self):
        path = self.settings.root / "study-providers.json"
        if not path.exists():
            return {"id": "deepseek", "base_url": "https://api.deepseek.com", "model": self.settings.data["deepseek_model"],
                    "key": self.settings.key(), "json_mode": True, "disable_thinking": True}
        config = json.loads(path.read_text(encoding="utf-8"))
        selected = next((p for p in config["providers"] if p["id"] == config["selected"]), None)
        if not selected:
            raise ValueError("学习模型配置中没有所选服务")
        parsed = urlparse(selected["base_url"])
        local = parsed.hostname in {"127.0.0.1", "localhost", "::1"}
        if (parsed.scheme != "https" and not (local and parsed.scheme == "http")) or parsed.username or parsed.query or parsed.fragment:
            raise ValueError("模型服务须使用 HTTPS；本机服务可用 HTTP")
        env_name = selected.get("key_env", "")
        if env_name and not re.fullmatch(r"[A-Z][A-Z0-9_]{1,100}", env_name):
            raise ValueError("模型 Key 必须引用环境变量名")
        # Only the exact official endpoint can reuse the existing DeepSeek credential.
        key = self.settings.key() if selected.get("use_saved_deepseek_key") and parsed.netloc == "api.deepseek.com" else os.getenv(env_name, "")
        if not local and not key:
            raise ValueError("学习模型的 Key 尚未配置")
        return {**selected, "key": key}

    def public(self):
        try:
            cfg = self.config()
            vision = cfg.get("supports_images", cfg.get("model") in {"deepseek-flash", "deepseek-v4-flash-vision-exp"}
                             and urlparse(cfg["base_url"]).netloc == "api.deepseek.com")
            return {"id": cfg["id"], "model": cfg["model"], "vision": bool(vision), "configured": bool(cfg.get("key")) or urlparse(cfg["base_url"]).hostname in {"localhost", "127.0.0.1", "::1"}}
        except (ValueError, KeyError, TypeError):
            return {"configured": False, "model": "配置需要检查"}

    def complete(self, messages, timeout):
        cfg = self.config()
        if not self.public()["configured"]:
            raise ValueError("尚未配置学习模型；可先在设置中保存 DeepSeek Key")
        payload = {"model": cfg["model"], "messages": messages, "max_tokens": 3500}
        if cfg.get("json_mode", True):
            payload["response_format"] = {"type": "json_object"}
        if cfg.get("disable_thinking"):
            payload["thinking"] = {"type": "disabled"}
        try:
            with httpx.Client(timeout=timeout, follow_redirects=False, trust_env=True) as client:
                response = client.post(cfg["base_url"].rstrip("/") + "/chat/completions", json=payload,
                                       headers={"Authorization": "Bearer " + cfg.get("key", "")})
            if response.status_code != 200:
                raise ValueError(f"学习模型 HTTP {response.status_code}，原有资料和计划未改变")
            if len(response.content) > 512_000:
                raise ValueError("学习模型响应过大")
            choice = response.json()["choices"][0]
            if choice.get("finish_reason") == "length":
                raise ValueError("模型输出未完成，请缩小问题范围后重试")
            return choice["message"]["content"]
        except (httpx.HTTPError, KeyError, IndexError, TypeError) as exc:
            raise ValueError("学习模型暂时没有返回有效结果；可先查看本地来源") from exc


SYSTEM = (Path(__file__).parent / "prompts" / "study-v1.txt").read_text(encoding="utf-8")


def check_citations(value, allowed):
    def validate(citations):
        for citation in citations:
            item = allowed.get(citation.evidence_id)
            parts = re.split(r"\s+", citation.quote.strip())
            match = re.search(r"\s+".join(re.escape(part) for part in parts), item["text"]) if item and parts != [""] else None
            if not match:
                raise ValueError("引用不在本次读取的原文中")
            # PDF line wrapping is typography, not a changed word. Return the real
            # contiguous source slice, never the model's reflowed rendition.
            citation.quote = match.group(0)
    for item in [*value.claims, *value.proposals, *value.connections, *([value.exercise] if value.exercise else [])]:
        validate(item.citations)
    for connection in value.connections:
        if len({c.evidence_id for c in connection.citations}) < 2:
            raise ValueError("知识关联需要两处不同证据，不能重复同一引文")
    for proposal in value.proposals:
        if proposal.kind == "correction" and len({allowed[c.evidence_id]["source_id"] for c in proposal.citations}) < 2:
            raise ValueError("转写纠正必须有不同来源支持；单一来源只能标记不确定")
        # A deadline is preserved as an exact quote, never parsed into a guessed date.
        if proposal.due_text and not any(proposal.due_text in allowed[c.evidence_id]["text"] for c in proposal.citations):
            raise ValueError("截止时间没有原文支持")


def run_agent(store, provider, *, course, question, purpose="ask", history=None, focus=None, max_steps=3):
    started = time.monotonic()
    allowed = {item["id"]: item for item in (focus or [])[:6] if item["course"] == course and item.get("active", True)}
    trace = []

    def retrieve(query):
        found = store.search(query, course, 6)
        # This is the entire tool allowlist: course-bound, read-only retrieval.
        for item in found:
            if len(allowed) < 12:
                allowed[item["id"]] = item
        trace.append({"tool": "search_sources", "query": query, "found": len(found)})
        return [{k: v for k, v in item.items() if k in {"id", "title", "kind", "locator", "text"}}
                for item in found if item["id"] in allowed]

    history = (history or [])[-6:]
    prior_topic = " ".join(x.get("question", "")[:160] for x in history[-2:])
    initial = retrieve(question + " " + prior_topic)
    initial = list({item["id"]: item for item in [*initial, *allowed.values()]}.values())
    catalog = [{k: v for k, v in item.items() if k in {"title", "kind"}} for item in store.sources(course)][:25]
    if not initial and not catalog:
        return {"status": "needs_sources", "reply": "这门课我还没有能参考的内容。先发一页课件、一张截图，或把困惑的原话贴过来就好。", "claims": [], "proposals": [], "uncertainties": [], "trace": trace}
    memory = [{"title": x["title"], "detail": x["detail"], "source": x.get("source", "student_confirmed_proposal")} for x in store.list("proposal")
              if x.get("course") == course and x.get("status") == "accepted" and x.get("proposal_kind") == "requirement"][:8]
    learner_state = [{"topic": p["question"], "attempt_count": len(p["attempts"]),
                      "last_self_rating": p["attempts"][-1]["rating"]}
                     for p in store.list("practice") if p.get("course") == course and p.get("attempts")][:5]
    tasks = [{k: t.get(k) for k in ("title", "deadline", "estimate_min", "estimate_max", "spent_minutes", "completed")}
             for t in store.list("task") if t.get("course") == course and t.get("status") == "accepted"][:8]
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": json.dumps({
        "course": course, "question": question, "purpose": purpose, "confirmed_requirements": memory, "conversation": history,
        "source_data": initial, "source_catalog": catalog, "self_reported_learning": learner_state, "confirmed_tasks": tasks}, ensure_ascii=False)}]
    failure = None
    try:
        for step in range(max_steps):
            remaining = 100 - (time.monotonic() - started)
            if remaining < 5:
                raise ValueError("本轮整理达到时间上限，已保存来源，可缩小问题后继续")
            raw = provider.complete(messages, min(30, remaining))
            trace.append({"step": step + 1, "operation": "model_response"})
            try:
                if not isinstance(raw, str) or len(raw) > 30000:
                    raise ValueError("响应超出约定长度")
                data = json.loads(raw)
                if data.get("action") == "read" and step < max_steps - 1:
                    target = Read.model_validate(data).evidence_id
                    if target not in allowed:
                        raise ValueError("只能展开已读的课程来源")
                    sid, index = target.rsplit(":", 1)
                    found = []
                    for n in range(max(0, int(index) - 1), int(index) + 2):
                        try:
                            item = store.evidence(sid + ":" + str(n))
                            if item["course"] == course and item["active"] and (len(allowed) < 12 or item["id"] in allowed):
                                allowed[item["id"]] = item
                                found.append(item)
                        except KeyError:
                            pass
                    trace.append({"tool": "read_surrounding_context", "evidence_id": target, "found": len(found)})
                    messages += [{"role": "assistant", "content": raw}, {"role": "user", "content": json.dumps({"source_data": found}, ensure_ascii=False)}]
                    continue
                if data.get("action") == "search" and step < max_steps - 1:
                    search = Search.model_validate(data)
                    if sum(len(m["content"]) for m in messages) > 28000:
                        raise ValueError("上下文达到上限，请根据已有证据完成")
                    messages += [{"role": "assistant", "content": raw}, {"role": "user", "content": json.dumps({"source_data": retrieve(search.query)}, ensure_ascii=False)}]
                    continue
                value = Final.model_validate(data)
                if purpose == "practice":
                    if value.exercise is None:
                        raise ValueError("练习请求需要一道完整题目")
                    # A recall exercise must not reveal its answer in surrounding prose.
                    value.claims, value.proposals, value.connections = [], [], []
                    value.reply = "先不看资料，试着用自己的话回答。写下卡住的地方也可以。"
                    value.next_question = ""
                check_citations(value, allowed)
            except (ValidationError, ValueError, AttributeError) as exc:
                failure = "模型的结构或引文校验未通过"
                if step < max_steps - 1:
                    messages.append({"role": "user", "content": "上次输出未通过结构/引文校验。请按约定 JSON 格式完成，quote 逐字引用已给来源，不补写日期。"})
                    continue
                raise ValueError(failure) from exc
            result = value.model_dump(exclude={"action"})
            if any(item.get("kind") == "image_reading" for item in allowed.values()):
                result["uncertainties"].append("图片内容由模型识读，尚未人工核对。公式、数字和模糊文字请点开原图确认。")
            saved = []
            for proposal in result["proposals"]:
                kind = proposal.pop("kind")
                pid = digest([course, kind, proposal])[:32]
                try:
                    item = store.get(pid, "proposal")  # Preserve a previous accept/reject decision.
                except KeyError:
                    item = store.save("proposal", {**proposal, "proposal_kind": kind, "course": course, "status": "pending"}, pid)
                saved.append(item)
            result["proposals"] = saved
            if result["exercise"]:
                practice = store.save("practice", {**result["exercise"], "course": course, "attempts": [], "due_at": time.time()})
                result["exercise"] = {k: v for k, v in practice.items() if k != "expected_answer"}
            result.update(status="ready", trace=trace, evidence=list(allowed.values()),
                          prompt_version="study-v1", elapsed_seconds=round(time.monotonic() - started, 2))
            result["run_id"] = store.save_run({"course": course, "question": question, **result})
            return result
    except ValueError as exc:
        store.save_run({"course": course, "status": "failed", "trace": trace, "error": str(exc)[:240]})
        raise
    raise ValueError(failure or "本轮没有形成可核对的结果")
