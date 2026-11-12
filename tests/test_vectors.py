import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from assistant_service.study_agent.storage import StudyStore
from assistant_service.study_agent.knowledge import set_policy
from assistant_service.study_agent.knowledge_base import search_knowledge_base, prepare_quiz
from assistant_service.study_agent.vectors import search_vectors


class Encoder:
    def __init__(self):
        self.calls = []

    def encode(self, texts, **kwargs):
        self.calls.extend(texts)
        return [[1, 0] if any(w in t for w in ("等待", "predicate", "replacement")) else [0, 1] for t in texts]


class VectorTests(unittest.TestCase):
    def test_semantic_recall_cache_and_source_policy(self):
        with tempfile.TemporaryDirectory() as root:
            model = Path(root) / "model"
            model.mkdir()
            encoder = Encoder()
            store = StudyStore(Path(root))
            def source(course, text, fingerprint):
                return store.source(origin="slides", course=course, title="Slide", kind="material",
                                    fingerprint=fingerprint, chunks=[{"text": text, "locator": {"page": 2}}])
            old = source("OS", "predicate", "1")
            source("Other", "predicate", "2")
            with patch.dict(os.environ, {"STUDY_EMBEDDING_MODEL": str(model)}), patch(
                    "assistant_service.study_agent.vectors._model", return_value=encoder):
                found = search_knowledge_base(store, "等待", "OS")
                self.assertEqual(found["retrieval"], "hybrid_fts5_vector")
                self.assertEqual([e["source_id"] for e in found["items"]], [old["id"]])
                self.assertEqual(found["items"][0]["locator"], {"page": 2})
                lexical = search_knowledge_base(store, "predicate", "OS")
                self.assertEqual(lexical["items"][0]["query_match"]["basis"], "phrase")
                quiz = prepare_quiz(store, "OS", "predicate", count=1)
                self.assertEqual(quiz["status"], "ready")
                self.assertEqual(len(quiz["evidence"]), 1)
                calls = len(encoder.calls)
                search_knowledge_base(store, "等待", "OS")
                self.assertEqual(len(encoder.calls), calls + 1)
                new = source("OS", "replacement", "3")
                items, _ = search_vectors(store, "等待", ["OS"])
                self.assertEqual([e["source_id"] for e in items], [new["id"]])
                set_policy(store, new["id"], role="reference", excluded=True)
                self.assertEqual(search_vectors(store, "等待", ["OS"])[0], [])

    def test_missing_model_falls_back_with_status(self):
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ, {"STUDY_EMBEDDING_MODEL": root + "/missing"}):
            store = StudyStore(Path(root))
            store.source(origin="a", course="OS", title="predicate", kind="material", fingerprint="1",
                         chunks=[{"text": "predicate", "locator": {}}])
            result = search_knowledge_base(store, "predicate", "OS")
            self.assertTrue(result["items"])
            self.assertEqual(result["retrieval"], "keyword_fts5")
            self.assertEqual(result["vector_retrieval"]["OS"]["status"], "unavailable")
