"""Ephemeral store for generated raster bytes (Stage 6 asset-renderer).

Generated images live in process memory and die with the instance (Phase 16
decision): the web falls back to its deterministic placeholder for any ref this
store has lost. It is an in-memory cache, never a source of truth — the DB
never stores image bytes, only the manifest refs in JobResult.assets.
"""

from __future__ import annotations

import threading


class JobAssetStore:
    """In-memory generated raster bytes keyed by (job_id, ref)."""

    def __init__(self, capacity: int = 100) -> None:
        self._assets: dict[str, dict[str, dict]] = {}
        self._capacity = capacity
        self._lock = threading.Lock()

    def put(self, job_id: str, ref: str, mime: str, data: bytes) -> None:
        with self._lock:
            bucket = self._assets.setdefault(job_id, {})
            bucket[ref] = {"mime": mime, "data": data}
            while len(self._assets) > self._capacity:
                oldest = next(iter(self._assets))
                del self._assets[oldest]

    def get(self, job_id: str, ref: str) -> dict | None:
        with self._lock:
            return self._assets.get(job_id, {}).get(ref)

    def job_refs(self, job_id: str) -> list[dict]:
        with self._lock:
            return [{"ref": ref, "mime": entry["mime"], "size_bytes": len(entry["data"])} for ref, entry in self._assets.get(job_id, {}).items()]