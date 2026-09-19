"""HTTP image providers for Stage 6 asset-renderer (raster generation).

The block-parallel design of the repair ladder does NOT apply to images: each
asset is generated once with bounded per-image failure (placeholder fallback,
E-IMG-001) and is never retried in a thrash loop — the pipeline must keep its
honest-failure posture while staying within the free-tier budget of the image
vendor.

Hugging Face Inference (free): POST {base_url}/{model} with an `x-wait-for-model:
true` header (the endpoint blocks until the VM is warm instead of returning 503).
Note: the legacy api-inference.huggingface.co host was retired; the live router
host is router.huggingface.co/hf-inference/models (token needs the Inference
Providers permission).

Pollinations (free, tokenless): GET {base_url}/{url-encoded prompt}?width&height
returns a raster directly, no auth. Used as the zero-credential image provider.
"""

from __future__ import annotations

import time
from typing import Any
from urllib.parse import quote

import httpx

from app.providers.protocol import ImageResult


class HuggingFaceImageProvider:
    name = "huggingface"

    def __init__(
        self,
        *,
        token: str,
        model: str,
        base_url: str = "https://router.huggingface.co/hf-inference/models",
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


class PollinationsImageProvider:
    name = "pollinations"

    def __init__(
        self,
        *,
        base_url: str = "https://image.pollinations.ai/prompt",
        model: str = "",
        timeout_s: float = 120.0,
        transport: Any = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout_s = timeout_s
        self.transport = transport

    async def generate(self, *, prompt: str, size: str) -> ImageResult:
        started = time.perf_counter()
        width, height = _parse_size(size)
        params: dict[str, Any] = {"width": width, "height": height, "nologo": "true"}
        if self.model:
            params["model"] = self.model
        url = f"{self.base_url}/{quote(prompt, safe='')}"
        headers = {"Accept": "image/*", "User-Agent": "landing-ai/0.1 (image-provider)"}
        model_label = self.model or self.name
        try:
            async with httpx.AsyncClient(
                timeout=self.timeout_s, transport=self.transport, follow_redirects=True
            ) as client:
                res = await client.get(url, params=params, headers=headers)
        except Exception as exc:  # noqa: BLE001 — network/vendor failure is a per-image bounded outcome
            return ImageResult(
                ok=False,
                message=f"pollinations image request failed: {exc}",
                model=model_label,
                latency_ms=(time.perf_counter() - started) * 1000.0,
            )

        latency_ms = (time.perf_counter() - started) * 1000.0
        content_type = res.headers.get("content-type", "image/jpeg").split(";")[0].strip()
        if res.status_code != 200 or not content_type.startswith("image/") or not res.content:
            return ImageResult(
                ok=False,
                message=f"pollinations {res.status_code}: {res.text[:300].strip() or 'image request failed'}",
                model=model_label,
                latency_ms=latency_ms,
            )
        return ImageResult(
            ok=True,
            data=res.content,
            mime=content_type,
            message="ok",
            model=model_label,
            latency_ms=latency_ms,
        )


def _parse_size(size: str) -> tuple[int, int]:
    try:
        width, height = size.lower().split("x", 1)
        return _clamp_dim(width), _clamp_dim(height)
    except Exception:  # noqa: BLE001 — any malformed size falls back to the default
        return 1024, 1024


def _clamp_dim(value: str) -> int:
    return max(64, min(1536, int(value)))


def _error_text(res: httpx.Response) -> str:
    try:
        body = res.json()
        if isinstance(body, dict) and body.get("error"):
            return f"huggingface {res.status_code}: {body['error']}"
    except Exception:  # noqa: BLE001, S110 — best-effort error extraction
        pass
    text = res.text[:300].strip()
    return f"huggingface {res.status_code}: {text or 'image request failed'}"