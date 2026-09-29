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

import asyncio
import hashlib
import ipaddress
import socket
import time
from typing import Any
from urllib.parse import quote

import httpx

from app.providers.protocol import ImageResult

# Transient HTTP statuses worth ONE bounded retry on a subsequent mirror/attempt
# (408/425/429/5xx). A 4xx/oversize/non-image result is NOT retried: it is
# deterministic enough that a retry would thrash the free-tier budget for no
# gain (E-IMG-001 posture stays: bounded per-image failure, never a job-killer).
RETRYABLE_IMAGE_STATUS = frozenset({408, 425, 429, 500, 502, 503, 504})


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
    """Pollinations (free, tokenless) raster generation.

    Reliability model (review PHG-001):
    - deterministic seed: SHA-256 of the prompt feeds the `seed` param, so a
      retry re-renders the SAME image (never a different-looking asset on a
      transient network blip);
    - mirrors: an ordered ``base_urls`` list is tried in fallback order; only
      transient statuses (RETRYABLE_IMAGE_STATUS) move to the next mirror —
      a 4xx/oversize/non-image reply returns immediately;
    - bounded retries: at most ``retries`` attempts (1 by default) with a short
      delay between them; every attempt reuses the same prompt+seed.
    """

    name = "pollinations"

    def __init__(
        self,
        *,
        base_url: str = "https://image.pollinations.ai/prompt",
        model: str = "",
        timeout_s: float = 120.0,
        transport: Any = None,
        base_urls: list[str] | None = None,
        retries: int = 1,
        retry_delay_s: float = 2.5,
        seed: str = "prompt-sha",
    ) -> None:
        self.base_urls = [u.rstrip("/") for u in (base_urls or [base_url])] or [base_url.rstrip("/")]
        # mirror hosts must all be allowlisted for egress; redirects to any
        # other host are rejected before bytes are trusted (SSRF defence).
        self._allow_hosts = {_host_of(u) for u in self.base_urls}
        self.model = model
        self.timeout_s = timeout_s
        self.transport = transport
        self.retries = max(0, int(retries))
        self.retry_delay_s = max(0.0, float(retry_delay_s))
        self.seed_mode = seed

    def _seed_for(self, prompt: str) -> int | None:
        """Deterministic per-prompt seed → same prompt, same raster, on retry."""
        if self.seed_mode == "prompt-sha":
            return int.from_bytes(hashlib.sha256(prompt.encode("utf-8")).digest()[:4], "big")
        try:
            return int(self.seed_mode)
        except (TypeError, ValueError):
            return None  # any other mode: vendor default (non-deterministic)

    async def generate(self, *, prompt: str, size: str) -> ImageResult:
        started = time.perf_counter()
        width, height = _parse_size(size)
        params: dict[str, Any] = {"width": width, "height": height, "nologo": "true"}
        seed = self._seed_for(prompt)
        if seed is not None:
            params["seed"] = seed
        if self.model:
            params["model"] = self.model
        headers = {"Accept": "image/*", "User-Agent": "landing-ai/0.1 (image-provider)"}
        model_label = self.model or self.name
        path = quote(prompt, safe="")

        last: ImageResult | None = None
        for attempt in range(self.retries + 1):
            if attempt > 0 and self.retry_delay_s > 0:
                await asyncio.sleep(self.retry_delay_s)
            for base_url in self.base_urls:
                url = f"{base_url}/{path}"
                result = await self._attempt(url, params, headers, model_label, started)
                if result.ok:
                    return result
                if result.message and "not in allowlist" in result.message:
                    return result  # SSRF guard: never retry a blocked host
                status = _status_of(result)
                if status is not None and status not in RETRYABLE_IMAGE_STATUS:
                    return result  # parseable non-transient → fail immediately, no fan-out
                last = result
        return last or ImageResult(
            ok=False, message="pollinations image request failed: no mirror returned an image", model=model_label, latency_ms=(time.perf_counter() - started) * 1000.0
        )

    async def _attempt(
        self,
        url: str,
        params: dict[str, Any],
        headers: dict[str, str],
        model_label: str,
        started: float,
    ) -> ImageResult:
        try:
            async with httpx.AsyncClient(
                timeout=self.timeout_s, transport=self.transport, follow_redirects=True
            ) as client:
                res = await client.get(url, params=params, headers=headers)
        except Exception as exc:  # noqa: BLE001 — network/vendor failure is a bounded outcome
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
            return ImageResult(ok=False, message=str(exc), model=model_label, latency_ms=latency_ms)
        content_type = res.headers.get("content-type", "image/jpeg").split(";")[0].strip()
        if res.status_code != 200 or not content_type.startswith("image/") or not res.content:
            detail = res.text[:300].strip() if res.text else "image request failed"
            return ImageResult(ok=False, message=f"pollinations {res.status_code}: {detail}", model=model_label, latency_ms=latency_ms)
        return ImageResult(ok=True, data=res.content, mime=content_type, message="ok", model=model_label, latency_ms=latency_ms)


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


def _status_of(result: ImageResult) -> int | None:
    """Best-effort HTTP status extracted from an ImageResult message.

    Failures carry `pollinations <status>: …` / `huggingface <status>: …`
    messages. A pure transport/network failure has no numeric status → None
    (retryable: a mirror may succeed). A parseable non-transient status
    (e.g. 400/404 or a 200-with-non-image-body) is deterministic → no retry.
    """
    message = result.message or ""
    for token in message.split():
        cleaned = token.strip(": ;,.")
        if cleaned.isdigit():
            try:
                return int(cleaned)
            except ValueError:
                continue
    return None