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


class OpenAIProvider:
    name = "openai"

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
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": prompt.system},
            {"role": "user", "content": prompt.render(inputs)},
        ]
        if feedback:
            messages.append({"role": "user", "content": f"REPAIR FEEDBACK: {feedback}"})
        payload = {
            "model": params.model,
            "temperature": params.temperature,
            "max_tokens": params.max_output_tokens,
            "messages": messages,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": prompt.name.replace("-", "_"),
                    "strict": True,
                    "schema": schema,
                },
            },
        }
        try:
            resp = await self._client.post(
                f"{self.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
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