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

import ipaddress
import socket
import time
from typing import Any
from urllib.parse import quote

import httpx

from app.providers.protocol import ImageResult


def _host_of(url: str) -> str:
    try:
        parsed = httpx.URL(url)
        return parsed.host.lower() if parsed.host is not None else "invalid"
    except Exception:  # noqa: BLE001 — unparseable URLs fail closed
        return "invalid"


def _is_private_host(host: str) -> bool:
    """Best-effort DNS resolution → reject loopback/private/link-local/multicast/
    reserved ranges (SSRF defense-in-depth). Unresolvable (tests, offline) hosts
    are treated as safe so local transports keep working; the allowlist below is
    the primary gate and is never skipped."""
    try:
        for info in socket.getaddrinfo(host, None):
            ip = ipaddress.ip_address(info[4][0])
            if (
                ip.is_loopback
                or ip.is_private
                or ip.is_link_local
                or ip.is_multicast
                or ip.is_reserved
                or ip.is_unspecified
            ):
                return True
    except OSError:
        pass
    return False


def assert_safe_egress(url: str, allow_hosts: set[str]) -> str:
    """Fail-closed egress guard for the image providers (review ط SSRF).

    The ONLY hosts the renderer may talk to are the configured provider hosts
    (env/base_url, never schema content). A redirect to any other host — or to a
    private/loopback IP behind a public hostname — turns the request into an
    SSRF probe of the Render internal network, so it is rejected before the
    bytes are trusted. Returns the (harmless) scheme prefix for diagnostics."""
    host = _host_of(url)
    if host == "invalid" or host not in allow_hosts:
        raise ValueError(f"image provider egress blocked: host {host!r} not in allowlist")
    if _is_private_host(host):
        raise ValueError(f"image provider egress blocked: host {host!r} resolves to a private address")
    return host


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
        self._allow_hosts = {_host_of(self.base_url)}

    async def generate(self, *, prompt: str, size: str) -> ImageResult:
        started = time.perf_counter()
        url = f"{self.base_url}/{self.model}"
        try:
            assert_safe_egress(url, self._allow_hosts)
        except ValueError as exc:
            return ImageResult(
                ok=False,
                message=str(exc),
                model=self.model,
                latency_ms=(time.perf_counter() - started) * 1000.0,
            )
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
        self._allow_hosts = {_host_of(self.base_url)}

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
        try:
            assert_safe_egress(str(res.url), self._allow_hosts)
        except ValueError as exc:
            return ImageResult(
                ok=False,
                message=str(exc),
                model=model_label,
                latency_ms=latency_ms,
            )
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