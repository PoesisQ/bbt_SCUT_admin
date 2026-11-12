"""Offline embeddings with persistent SQLite caching and current-source filtering."""
from __future__ import annotations

import json
import math
import os
from functools import lru_cache
from pathlib import Path
from threading import RLock

from .storage import digest

_lock = RLock()


@lru_cache(maxsize=2)
def _model(path, version):
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer(path, local_files_only=True, trust_remote_code=False, device="cpu")


def _unit(vector):
    values = [float(v) for v in vector]
    norm = math.sqrt(sum(v * v for v in values))
    if not values or not math.isfinite(norm) or norm == 0:
        raise ValueError("Invalid embedding")
    return [v / norm for v in values]


def search_vectors(store, query, courses, limit=24):
    """Return (ranked evidence, status). No network requests or implicit downloads."""
    path = os.environ.get("STUDY_EMBEDDING_MODEL", "").strip()
    if not path:
        return [], {"status": "disabled"}
    try:
        path = str(Path(path).resolve(strict=True))
        # Include file versions so replacing weights at the same path invalidates caches.
        version = digest([(str(p.relative_to(path)), p.stat().st_size, p.stat().st_mtime_ns)
                          for p in sorted(Path(path).rglob("*")) if p.is_file()])
        with _lock:
            model = _model(path, version)
            with store.connect() as db:
                db.execute("CREATE TABLE IF NOT EXISTS evidence_vectors(model TEXT, evidence_id TEXT, fingerprint TEXT, vector TEXT, PRIMARY KEY(model,evidence_id))")
                rows = db.execute("SELECT e.data FROM evidence e JOIN sources s ON s.id=e.source_id WHERE s.active=1").fetchall()
                cached = {r[0]: (r[1], r[2]) for r in db.execute(
                    "SELECT evidence_id,fingerprint,vector FROM evidence_vectors WHERE model=?", (version,))}
            policies = {(p["course"], p["origin"]): p for p in store.list("source_policy")}
            sources = {s["id"]: s for s in store.sources()}
            items = []
            for row in rows:
                item = json.loads(row[0])
                source = sources.get(item["source_id"])
                if (item["course"] in courses and source and
                        not policies.get((item["course"], source["origin"]), {}).get("excluded")):
                    items.append(item)
            pending, vectors = [], {}
            for item in items:
                text = item["title"] + "\n" + item["text"]
                fingerprint = digest(text)
                old = cached.get(item["id"])
                if old and old[0] == fingerprint:
                    vectors[item["id"]] = _unit(json.loads(old[1]))
                else:
                    pending.append((item["id"], fingerprint, text))
            for start in range(0, len(pending), 32):
                batch = pending[start:start + 32]
                encoded = model.encode([v[2] for v in batch], normalize_embeddings=True, show_progress_bar=False)
                if len(encoded) != len(batch):
                    raise ValueError("Embedding count mismatch")
                with store.connect() as db:
                    for (eid, fingerprint, _), raw in zip(batch, encoded):
                        vector = vectors[eid] = _unit(raw)
                        db.execute("INSERT OR REPLACE INTO evidence_vectors VALUES(?,?,?,?)",
                                   (version, eid, fingerprint, json.dumps(vector)))
            q = _unit(model.encode([query], normalize_embeddings=True, show_progress_bar=False)[0])
            scored = []
            for item in items:
                vector = vectors[item["id"]]
                if len(q) != len(vector):
                    raise ValueError("Embedding dimension mismatch")
                score = sum(a * b for a, b in zip(q, vector))
                if score >= 0.35:
                    # Recheck current validity after potentially slow embedding work.
                    current = store.evidence(item["id"])
                    if current.get("active") and not current.get("policy", {}).get("excluded"):
                        scored.append((score, current))
            scored.sort(key=lambda pair: (-pair[0], pair[1]["id"]))
            return [{**item, "vector_score": round(score, 5)} for score, item in scored[:limit]], {"status": "ready", "model_version": version}
    except Exception as exc:
        # Preserve lexical retrieval; expose failure type without private paths/text.
        return [], {"status": "unavailable", "error": type(exc).__name__}
