"""HTTP image providers for Stage 6 asset-renderer (raster generation).

The block-parallel design of the repair ladder does NOT apply to images: each
asset is generated once with bounded per-image failure (placeholder fallback,
E-IMG-001) and is never retried in a thrash loop — the pipeline must keep its
honest-failure posture while staying within the free-tier budget of the image
vendor.

Hugging Face Inference (free): POST {base_url}/{model} with an `x-wait-for-model:
true` header (the endpoint blocks until the VM is warm instead of returning 503).
"""

from __future__ import annotations

import time
from typing import Any

import httpx

from app.providers.protocol import ImageResult


class HuggingFaceImageProvider:
    name = "huggingface"

    def __init__(
        self,
        *,
        token: str,
        model: str,
        base_url: str = "https://api-inference.huggingface.co/models",
        timeout_s: float = 120.0,
        transport: Any = None,
    ) -> None:
        self.token = token
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout_s = timeout_s
        self.transport = transport

    async def generate(self, *, prompt: str, size: str) -> ImageResult:
        started = time.perf_counter()
        url = f"{self.base_url}/{self.model}"
        headers = {
            "Authorization": f"Bearer {self.token}",
            "x-wait-for-model": "true",
            "Accept": "image/*",
            "Content-Type": "application/json",
        }
        try:
            async with httpx.AsyncClient(timeout=self.timeout_s, transport=self.transport) as client:
                res = await client.post(url, headers=headers, json={"inputs": prompt, "parameters": {"size": size}})
        except Exception as exc:  # noqa: BLE001 — network/vendor failure is a per-image bounded outcome
            return ImageResult(
                ok=False,
                message=f"huggingface image request failed: {exc}",
                model=self.model,
                latency_ms=(time.perf_counter() - started) * 1000.0,
            )

        latency_ms = (time.perf_counter() - started) * 1000.0
        if res.status_code != 200:
            message = _error_text(res)
            return ImageResult(ok=False, message=message, model=self.model, latency_ms=latency_ms)

        content_type = res.headers.get("content-type", "image/png").split(";")[0].strip()
        return ImageResult(
            ok=True,
            data=res.content,
            mime=content_type,
            message="ok",
            model=self.model,
            latency_ms=latency_ms,
        )


def _error_text(res: httpx.Response) -> str:
    try:
        body = res.json()
        if isinstance(body, dict) and body.get("error"):
            return f"huggingface {res.status_code}: {body['error']}"
    except Exception:  # noqa: BLE001, S110 — best-effort error extraction
        pass
    text = res.text[:300].strip()
    return f"huggingface {res.status_code}: {text or 'image request failed'}"