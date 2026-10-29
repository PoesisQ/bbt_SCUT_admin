from __future__ import annotations

import hashlib
import json
import re
import time

import httpx
from .study_agent.prompt_catalog import read as read_prompt
from .telemetry import traced, model_start, model_finish, phase, emit

CATEGORIES = {
    "attendance": ("点名／签到", "urgent", r"点名|签到|考勤|抽查.{0,5}到|没来的同学"),
    "qr": ("扫码互动", "urgent", r"扫.{0,4}码|二维码|雨课堂|学习通.{0,8}(答题|签到)"),
    "question": ("提问", "urgent", r"请.{0,10}回答|哪位同学|谁来.{0,5}(回答|说)|找.{0,5}同学|同学.{0,6}回答"),
    "assignment": ("作业要求", "important", r"作业|课后.{0,6}(完成|练习)|提交|截止|交.{0,4}(报告|实验)"),
    "quiz": ("测验／考试", "urgent", r"随堂.{0,5}(测试|测验)|小测|测验|考试|现在.{0,5}答题"),
    "requirements": ("课程要求", "important", r"课程要求|这门课.{0,8}(要求|需要)|必须.{0,8}(完成|参加)|教材|参考书"),
    "schedule": ("课程安排", "important", r"调课|停课|补课|下[周次节].{0,15}(讲|上|课|安排)|课程安排|上课时间"),
    "grading": ("评分要求", "important", r"平时[成绩分]|期末[成绩分]|总评|及格|学分|扣分|加分|占.{0,5}(分|%|％|百分)|百分之"),
    "reminder": ("特别提醒", "important", r"特别提醒|务必|一定要注意|重点.{0,4}(考|掌握)|考试重点|不要忘记"),
}


def event_id(category: str, evidence: str, start: float) -> str:
    return hashlib.sha256(f"{category}:{evidence}:{int(start // 20)}".encode()).hexdigest()[:20]


def rule_events(segments: list[dict]) -> list[dict]:
    result = []
    for segment in segments:
        if segment.get("quality") == "uncertain":
            continue
        text = segment["text"]
        for category, (label, priority, pattern) in CATEGORIES.items():
            if re.search(pattern, text):
                # Explicit negation should not trigger urgent attendance reminders.
                if category == "attendance" and re.search(r"(不|无需|不用|取消).{0,3}(点名|签到|考勤)", text):
                    continue
                result.append({"id": event_id(category, text, segment["start"]), "category": category,
                               "label": label, "priority": priority, "message": "疑似" + label + "，请核对原文",
                               "evidence": text, "start": segment["start"], "end": segment["end"],
                               "segment_ids": [segment["id"]], "source": "local_rule", "confidence": 0.55})
    return result


SYSTEM = read_prompt("classroom-v1")


class OutputTooLong(ValueError):
    pass


class AnalysisPaused(Exception):
    """The user stopped analysis while a request was in flight."""


EVENT_TASK = read_prompt("events-v1")


def context_packs(segments: list[dict], budget=160000) -> list[list[dict]]:
    """Keep a lecture together when possible; very long lectures overlap by 90 seconds."""
    result, start = [], 0
    while start < len(segments):
        end, size = start, 0
        while end < len(segments):
            cost = len(segments[end]["text"]) + 70
            if end > start and size + cost > budget:
                break
            size += cost
            end += 1
        result.append(segments[start:end])
        if end == len(segments):
            break
        overlap = end
        while overlap > start + 1 and segments[overlap - 1]["end"] >= segments[end - 1]["end"] - 90:
            overlap -= 1
        # At most half the previous window overlaps, so malformed timestamps still progress.
        start = max(overlap, start + max(1, (end - start) // 2))
    return result


def analysis_packs(segments: list[dict]) -> list[list[dict]]:
    """Bound both serialized input and citation count, including short school subtitles."""
    packs, current, size = [], [], 0
    for segment in segments:
        cost = len(json.dumps({k: segment[k] for k in ("start", "end", "text")}, ensure_ascii=False)) + 16
        if current and (len(current) >= 96 or size + cost > 6200):
            packs.append(current)
            current, size = [], 0
        current.append(segment)
        size += cost
    if current:
        packs.append(current)
    return packs


class Analyzer:
    def __init__(self, settings, transport=None):
        self.settings = settings
        self.transport = transport
        self.client = httpx.Client(transport=transport, trust_env=False, limits=httpx.Limits(max_connections=8,max_keepalive_connections=4))

    def close(self):
        self.client.close()

    @traced("classroom")
    def consolidate(self, segments, *, checkpoint=None, save=lambda: None, check=lambda: None):
        """Read original lecture text, then reconcile repeated notices across long windows.

        Cache each completed request. A failed/paused pass never replaces the saved events.
        """
        cache = checkpoint if checkpoint is not None else {}

        def request(rows, key, depth=0, candidates=None):
            check()
            if key in cache:
                emit("cache.hit", "复用已核对的课堂事项", {"cache":"lecture_events","part":key})
                return cache[key]
            try:
                value = self._request(rows, summary=True, task=EVENT_TASK, event_candidates=candidates)["events"]
            except OutputTooLong:
                if len(rows) < 4 or depth >= 8:
                    raise ValueError("整课事项输出过长；已保留原记录和完成部分，请继续整理") from None
                mid = len(rows) // 2
                overlap = min(12, max(1, len(rows) // 8))
                value = merge_events(request(rows[:mid + overlap], key + "L", depth + 1),
                                     request(rows[mid - overlap:], key + "R", depth + 1))
                # A split can separate a deadline from its task; reunite their cited context.
                value = reconcile(value, rows, key + "RZ", depth + 1)
            check()
            cache[key] = value
            save()
            return value

        def reconcile(events, rows, key, depth=0):
            if not events:
                return []
            ids = {i for e in events for i in e["segment_ids"]}
            positions = [i for i, s in enumerate(rows) if s["id"] in ids]
            include = {j for i in positions for j in range(max(0, i - 8), min(len(rows), i + 9))}
            context = [s for i, s in enumerate(rows) if i in include]
            if depth >= 8:
                raise ValueError("事项过多，尚未完成跨段合并；已保存进度，可更换模型后继续")
            # Reclassification must not delete a notice. Reconcile all categories together,
            # with the candidate meanings AND their original surrounding text available.
            return request(context, key, depth, candidates=events)

        packs = context_packs(segments)
        events = []
        for i, pack in enumerate(packs):
            events = merge_events(events, request(pack, f"whole-{i}"))
        if len(packs) > 1:
            events = reconcile(events, segments, "reconcile-")
        check()
        return events

    @traced("classroom")
    def analyze(self, segments: list[dict], *, summary=False, _depth=0) -> dict:
        try:
            return self._request(segments, summary=summary)
        except OutputTooLong:
            if len(segments) < 2 or _depth >= 8:
                raise ValueError("一段字幕的分析仍超出输出上限；已保留完成部分，请重试或更换分析模型") from None
            middle = len(segments) // 2
            left = self.analyze(segments[:middle], summary=summary, _depth=_depth + 1)
            right = self.analyze(segments[middle:], summary=summary, _depth=_depth + 1)
            return {"events": merge_events(left["events"], right["events"]),
                    "topics": left["topics"] + right["topics"],
                    "overview": left["overview"] + "\n\n" + right["overview"]}

    @traced("classroom")
    def synthesize(self, topics: list[dict]) -> dict:
        if not topics:
            return {"title": "", "overview": "", "groups": []}
        rows = [{"id": str(i), "start": t["start"], "end": t["end"],
                 "text": t["title"] + "：" + t.get("detail", "")} for i, t in enumerate(topics)]
        result = self._request(rows, summary=True, task="以下是整节课各段的知识点笔记。请综合全部内容，额外返回 title（24字内的整课主题标题），overview（200字内整课概览），topics（3至6个主要知识主题，将相关内容归组并引用代表片段ID）。以教学内容为主，不要把开场助教介绍、课堂寒暄或作业通知作为整课主题。此步骤 events 为空，不增加原笔记没有的事实。")
        return {"title": result.get("title", ""), "overview": result["overview"],
                "groups": [{"title": t["title"], "detail": t["detail"],
                            "topic_indices": [int(i) for i in t["segment_ids"]]} for t in result["topics"]]}

    def _request(self, segments: list[dict], *, summary=False, task=None, event_candidates=None) -> dict:
        if not segments:
            return {"events": [], "topics": [], "overview": "无可分析字幕"}
        key = self.settings.key()
        if not key:
            raise ValueError("未配置 DeepSeek API Key；本地字幕和规则提醒仍可用")
        # Request-local references avoid echoing long database IDs hundreds of times.
        aliases = {f"s{i + 1}": s["id"] for i, s in enumerate(segments)}
        compact = [{"id": f"s{i + 1}", **{k: s[k] for k in ("start", "end", "text")}} for i, s in enumerate(segments)]
        material = {"task": task or ("课段总结和重要事项" if summary else "实时课堂事件检测"), "segments": compact}
        if event_candidates is not None:
            reverse = {v: k for k, v in aliases.items()}
            material["reconciliation"] = "这是跨段核对步骤。下面是候选事项及各处原文的前后文，并非连续字幕。逐项核对候选，合并同一任务的重复和补充、更正；保留互不相同的任务。排除仅为举例或没有原文支持的内容。分类可以调整，不要因分类变化遗漏事项。"
            material["candidates"] = [{**{k: e.get(k) for k in ("category", "message", "details")},
                                       "segment_ids": [reverse[i] for i in e["segment_ids"] if i in reverse]}
                                      for e in event_candidates]
        payload = {"model": self.settings.data["deepseek_model"], "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": json.dumps(material, ensure_ascii=False, separators=(",", ":"))}],
            "response_format": {"type": "json_object"}, "max_tokens": 6000,
            "temperature": 0.1, "stream": False}
        # New DeepSeek models offer non-thinking mode for latency-sensitive alerts.
        if self.settings.data["deepseek_model"].startswith(("deepseek-v4", "deepseek-flash")):
            payload["thinking"] = {"type": "disabled"}
        for attempt in range(3):
            body, ticket, recorded = {}, None, False
            try:
                with phase("classroom_events" if task == EVENT_TASK else "classroom_notes" if summary else "live_alerts", 6000):
                    ticket = model_start(payload, (key,))
                    response = self.client.post("https://api.deepseek.com/chat/completions", timeout=120 if task == EVENT_TASK else 60, json=payload,
                                               headers={"Authorization": "Bearer " + key})
                if response.status_code in {429, 500, 502, 503, 504} and attempt < 2:
                    model_finish(ticket, {}, (key,), error=f"HTTP {response.status_code}; retry {attempt+1}")
                    recorded = True
                    time.sleep(2 ** attempt)
                    continue
                if response.status_code != 200:
                    raise ValueError(f"DeepSeek HTTP {response.status_code}；请检查 Key、余额和模型名")
                body = response.json()
                model_finish(ticket, body, (key,))
                recorded = True
                choice = body["choices"][0]
                if choice.get("finish_reason") == "length":
                    raise OutputTooLong("分析结果超过输出上限；已保留完成的分段笔记，可以继续生成")
                parsed = json.loads(choice["message"]["content"])
                if not isinstance(parsed, dict):
                    raise TypeError("Expected JSON object")
                for field in ("events", "topics"):
                    for item in (parsed.get(field) or []):
                        if isinstance(item, dict) and isinstance(item.get("segment_ids"), list):
                            item["segment_ids"] = [aliases.get(i, "") if isinstance(i, str) else "" for i in item["segment_ids"]]
                if task == EVENT_TASK:
                    known = {s["id"]: s for s in segments}
                    for event in parsed.get("events") or []:
                        if isinstance(event, dict) and isinstance(event.get("segment_ids"), list):
                            event["evidence_quotes"] = [known[i]["text"] for i in event["segment_ids"] if i in known]
                result = self.validate(parsed, segments)
                if task == EVENT_TASK and len(result["events"]) != len(parsed.get("events") or []):
                    # Never turn invalid citations into a misleading "no important events" result.
                    raise TypeError("Whole-lecture event citations could not be verified")
                return result
            except (httpx.TransportError, json.JSONDecodeError, KeyError, TypeError) as exc:
                if ticket and not recorded:
                    model_finish(ticket, body, (key,), error=type(exc).__name__)
                    recorded = True
                if attempt == 2:
                    raise ValueError("DeepSeek 暂时无法返回有效分析；已保存字幕，可重新分析") from exc
                time.sleep(2 ** attempt)
            finally:
                if ticket and not recorded:model_finish(ticket, body, (key,), error="模型请求未完成")
        raise ValueError("DeepSeek 暂时繁忙，请稍后重试")

    @staticmethod
    def validate(body: dict, segments: list[dict]) -> dict:
        if not isinstance(body, dict):
            raise ValueError("分析返回值不是对象")
        known = {s["id"]: s for s in segments}

        def cited(item):
            ids = item.get("segment_ids", [])
            if not isinstance(ids, list) or not ids or any(not isinstance(i, str) or i not in known for i in ids):
                return []
            return sorted([known[i] for i in ids], key=lambda s: s["start"])

        events, topics = [], []
        for item in (body.get("events") or [])[:100]:
            if not isinstance(item, dict) or item.get("category") not in CATEGORIES:
                continue
            refs = cited(item)
            quotes = item.get("evidence_quotes")
            if quotes is None:
                quotes = [item.get("evidence")]
            if not refs or not isinstance(quotes, list) or not quotes or len(quotes) > max(24, len(known)):
                continue
            source = re.sub(r"\s", "", "".join(s["text"] for s in refs))
            if any(not isinstance(q, str) or not q.strip() or re.sub(r"\s", "", q) not in source for q in quotes):
                continue
            evidence = "\n…\n".join(quotes)
            category = item["category"]
            label, priority, _ = CATEGORIES[category]
            confidence = item.get("confidence", 0.5)
            if not isinstance(confidence, (float, int)) or not 0 <= confidence <= 1:
                confidence = 0.5
            message = item.get("message")
            if not isinstance(message, str):
                continue
            raw_details = item.get("details") or {}
            details = {k: raw_details[k][:1000] for k in ("action", "deadline", "submission", "requirements", "grading")
                       if isinstance(raw_details, dict) and isinstance(raw_details.get(k), str) and raw_details[k].strip()}
            events.append({"id": event_id(category, evidence, refs[0]["start"]), "category": category, "label": label,
                           "priority": priority, "message": message[:400], "evidence": evidence[:2000],
                           "segment_ids": [s["id"] for s in refs], "start": refs[0]["start"], "end": refs[-1]["end"],
                           "source": "deepseek", "confidence": confidence, "details": details,
                           "evidence_quotes": quotes})
        for item in (body.get("topics") or [])[:100]:
            if not isinstance(item, dict) or not isinstance(item.get("title"), str):
                continue
            refs = cited(item)
            if not refs:
                continue
            chapter = item.get("chapter")
            # A claimed textbook location must actually appear in the cited text.
            if not isinstance(chapter, str) or chapter not in "".join(s["text"] for s in refs):
                chapter = None
            topics.append({"title": item["title"][:200], "chapter": chapter,
                           "detail": str(item.get("detail", ""))[:1200], "start": refs[0]["start"], "end": refs[-1]["end"],
                           "segment_ids": [s["id"] for s in refs]})
        return {"events": events, "topics": topics, "overview": str(body.get("overview", ""))[:3000],
                "title": str(body.get("title", ""))[:80]}


def merge_events(existing: list[dict], incoming: list[dict]) -> list[dict]:
    result = list(existing)
    for event in incoming:
        same = next((i for i, e in enumerate(result) if e["category"] == event["category"] and
                     (e["id"] == event["id"] or (abs(e["start"] - event["start"]) < 20 and
                                                set(e["segment_ids"]) & set(event["segment_ids"])))), None)
        if same is None:
            result.append(event)
        elif event["source"] == "deepseek":
            result[same] = {**event, "id": result[same]["id"]}
    return sorted(result, key=lambda e: e["start"])
