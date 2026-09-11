"""Real HTTP providers (OpenAI / Anthropic).

Structured output policy (PART VI §6.4): native JSON-schema-bound output when the
provider supports it (OpenAI response_format.json_schema, Anthropic tool_use with
input_schema); providers never produce freeform text. These clients are swapped
in via routing config (`provider:` under a model class) — code never hardcodes a vendor.
No test in CI touches them (no keys); the stub is the default in tests/dev.
"""

from __future__ import annotations

import json
import time
from typing import Any

import httpx

from app.contracts import Outcome, Usage
from app.prompts.assets import PromptAsset
from app.providers.protocol import GenerationParams, ProviderResult

TIMEOUT_S = 30.0
MAX_RETRIES = 1


def _is_strict_compatible(node: Any) -> bool:
    """True when every object level in the JSON Schema is closed
    (additionalProperties: false).

    OpenAI/Groq strict structured-output mode REQUIRES additionalProperties:false
    on every object; schemas with open objects (e.g. section `slots`) would be
    rejected with a 400. Such schemas get strict:false and rely on the pipeline's
    post-validation + repair ladder (validate.py / repair.py).
    """
    if not isinstance(node, dict):
        return True
    if node.get("type") == "object":
        if node.get("additionalProperties") is not False:
            return False
        for sub in (node.get("properties") or {}).values():
            if not _is_strict_compatible(sub):
                return False
    for key in ("items", "additionalProperties", "contains", "not"):
        if isinstance(node.get(key), dict) and not _is_strict_compatible(node[key]):
            return False
    for key in ("anyOf", "oneOf", "allOf"):
        for sub in node.get(key) or []:
            if not _is_strict_compatible(sub):
                return False
    return True


class OpenAIProvider:
    name = "openai"
    # json_schema | json_object (json_object is the Ollama-compatible fallback:
    # plain JSON mode; post-validation + repair guarantee schema conformance).
    response_format: str = "json_schema"
    timeout_s: float = TIMEOUT_S

    def _request_headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}"}

    def __init__(self, api_key: str, base_url: str, client: httpx.AsyncClient | None = None) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self._client = client or httpx.AsyncClient(timeout=httpx.Timeout(self.timeout_s))

    async def generate_structured(
        self,
        *,
        schema: dict[str, Any],
        prompt: PromptAsset,
        inputs: dict[str, Any],
        params: GenerationParams,
        feedback: str | None = None,
    ) -> ProviderResult:
        started = time.perf_counter()
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": prompt.system},
            {"role": "user", "content": prompt.render(inputs)},
        ]
        if feedback:
            messages.append({"role": "user", "content": f"REPAIR FEEDBACK: {feedback}"})
        if self.response_format == "json_object":
            response_format: dict[str, Any] = {"type": "json_object"}
        else:
            response_format = {
                "type": "json_schema",
                "json_schema": {
                    "name": prompt.name.replace("-", "_"),
                    "strict": _is_strict_compatible(schema),
                    "schema": schema,
                },
            }
        payload = {
            "model": params.model,
            "temperature": params.temperature,
            "max_tokens": params.max_output_tokens,
            "messages": messages,
            "response_format": response_format,
        }
        try:
            resp = await self._client.post(
                f"{self.base_url}/chat/completions",
                headers=self._request_headers(),
                json=payload,
            )
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            return self._result(Outcome.timeout if isinstance(exc, httpx.TimeoutException) else Outcome.provider_error,
                                started, params.model, message=str(exc))
        if resp.status_code >= 400:
            outcome = Outcome.refused if resp.status_code in (401, 403, 429) else Outcome.provider_error
            return self._result(outcome, started, params.model, message=f"http {resp.status_code}")
        body = resp.json()
        try:
            content = body["choices"][0]["message"]["content"]
            data = json.loads(content)
        except (KeyError, IndexError, ValueError) as exc:
            return self._result(Outcome.malformed, started, params.model, message=f"unparseable: {exc}")
        if not isinstance(data, dict):
            # strict:false providers can return a bare array/scalar; that is a
            # malformed stage output (repairable), not a hard provider error.
            return self._result(Outcome.malformed, started, params.model, message="output is not a JSON object")
        usage = body.get("usage") or {}
        return ProviderResult(
            outcome=Outcome.ok,
            data=data,
            message="ok",
            usage=Usage(int(usage.get("prompt_tokens", 0)), int(usage.get("completion_tokens", 0))),
            model=params.model,
            latency_ms=(time.perf_counter() - started) * 1000.0,
        )

    def _result(self, outcome: Outcome, started: float, model: str, *, message: str) -> ProviderResult:
        return ProviderResult(
            outcome=outcome,
            message=message,
            usage=Usage(0, 0),
            model=model,
            latency_ms=(time.perf_counter() - started) * 1000.0,
        )


class OllamaProvider(OpenAIProvider):
    """Local Ollama via its OpenAI-compatible endpoint (/v1/chat/completions).

    Keyless (Authorization is ignored). Uses plain json_object mode — weaker
    local models are unreliable at JSON-schema binding, and the pipeline's
    post-validation + repair ladder (validate.py / repair.py) guarantees the
    canonical schema, exactly as with Groq's strict:false JSON mode.
    """

    name = "ollama"
    response_format = "json_object"
    # CPU inference is slow (~2-3 tok/s for llama3.1 8B); allow long generations.
    timeout_s = 900.0

    # Ollama rejects an empty `Authorization: Bearer ` header on any request.
    def _request_headers(self) -> dict[str, str]:
        return {}


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, api_key: str, base_url: str, client: httpx.AsyncClient | None = None) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self._client = client or httpx.AsyncClient(timeout=httpx.Timeout(TIMEOUT_S))

    async def generate_structured(
        self,
        *,
        schema: dict[str, Any],
        prompt: PromptAsset,
        inputs: dict[str, Any],
        params: GenerationParams,
        feedback: str | None = None,
    ) -> ProviderResult:
        started = time.perf_counter()
        tool_name = prompt.name.replace("-", "_")
        user_content = prompt.render(inputs)
        if feedback:
            user_content = f"{user_content}\n\nREPAIR FEEDBACK: {feedback}"
        payload = {
            "model": params.model,
            "max_tokens": params.max_output_tokens,
            "temperature": params.temperature,
            "system": prompt.system,
            "messages": [{"role": "user", "content": user_content}],
            "tools": [{"name": tool_name, "description": "Structured stage output", "input_schema": schema}],
            "tool_choice": {"type": "tool", "name": tool_name},
        }
        try:
            resp = await self._client.post(
                f"{self.base_url}/v1/messages",
                headers={
                    "x-api-key": self.api_key,
                    "anthropic-version": "2023-06-01",
                },
                json=payload,
            )
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            return ProviderResult(
                outcome=Outcome.timeout if isinstance(exc, httpx.TimeoutException) else Outcome.provider_error,
                message=str(exc),
                usage=Usage(0, 0),
                model=params.model,
                latency_ms=(time.perf_counter() - started) * 1000.0,
            )
        if resp.status_code >= 400:
            outcome = Outcome.refused if resp.status_code in (401, 403, 429) else Outcome.provider_error
            return ProviderResult(
                outcome=outcome,
                message=f"http {resp.status_code}",
                usage=Usage(0, 0),
                model=params.model,
                latency_ms=(time.perf_counter() - started) * 1000.0,
            )
        body = resp.json()
        usage = body.get("usage") or {}
        try:
            block = next(b for b in body["content"] if b.get("type") == "tool_use")
            data = block["input"]
        except (KeyError, StopIteration) as exc:
            return ProviderResult(
                outcome=Outcome.malformed,
                message=f"no tool_use block: {exc}",
                usage=Usage(0, 0),
                model=params.model,
                latency_ms=(time.perf_counter() - started) * 1000.0,
            )
        return ProviderResult(
            outcome=Outcome.ok,
            data=data,
            message="ok",
            usage=Usage(int(usage.get("input_tokens", 0)), int(usage.get("output_tokens", 0))),
            model=params.model,
            latency_ms=(time.perf_counter() - started) * 1000.0,
        )