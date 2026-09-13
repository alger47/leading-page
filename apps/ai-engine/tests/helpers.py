"""Test provider doubles: flaky (repairable), rigged (honest FAILED), raising (E-AI-005)."""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from app.contracts import Outcome, Usage
from app.prompts.assets import PromptAsset
from app.providers.protocol import GenerationParams, ProviderResult
from app.providers.stub import StubProvider


class FlakyProvider:
    """Succeeds like the stub, but fails the first `fail_first` calls per stage."""

    name = "flaky"

    def __init__(self, fail_first: int = 1) -> None:
        self.fail_first = fail_first
        self._stage_counts: dict[str, int] = defaultdict(int)
        self._delegate = StubProvider()

    async def generate_structured(
        self,
        *,
        schema: dict[str, Any],
        prompt: PromptAsset,
        inputs: dict[str, Any],
        params: GenerationParams,
        feedback: str | None = None,
    ) -> ProviderResult:
        self._stage_counts[prompt.name] += 1
        if self._stage_counts[prompt.name] <= self.fail_first:
            return ProviderResult(
                outcome=Outcome.malformed,
                data=None,
                message="malformed on purpose",
                usage=Usage(input_tokens=10, output_tokens=10),
                model=params.model,
                latency_ms=0.1,
            )
        return await self._delegate.generate_structured(
            schema=schema, prompt=prompt, inputs=inputs, params=params, feedback=feedback
        )


class RiggedProvider:
    """Always refuses — exercises the full repair ladder down to honest failure."""

    name = "rigged"

    async def generate_structured(
        self,
        *,
        schema: dict[str, Any],
        prompt: PromptAsset,
        inputs: dict[str, Any],
        params: GenerationParams,
        feedback: str | None = None,
    ) -> ProviderResult:
        return ProviderResult(
            outcome=Outcome.refused,
            data=None,
            message="refused in test",
            usage=Usage(input_tokens=10, output_tokens=10),
            model=params.model,
            latency_ms=0.1,
        )


class RaisingProvider:
    """Simulates a provider plugin crash (E-AI-005, no thrash retries)."""

    name = "raising"

    async def generate_structured(
        self,
        *,
        schema: dict[str, Any],
        prompt: PromptAsset,
        inputs: dict[str, Any],
        params: GenerationParams,
        feedback: str | None = None,
    ) -> ProviderResult:
        raise RuntimeError("simulated provider crash")


class QuotaThrottledProvider:
    """Refuses on the (quota-throttled) fast pool, delegates otherwise —
    simulates a free-tier 429 so the repair ladder swaps to the premium pool."""

    name = "quota-throttled"

    def __init__(self, throttled_model: str = "stub-fast", delegate: Any = None) -> None:
        self.throttled_model = throttled_model
        self._delegate = delegate or StubProvider()

    async def generate_structured(
        self,
        *,
        schema: dict[str, Any],
        prompt: PromptAsset,
        inputs: dict[str, Any],
        params: GenerationParams,
        feedback: str | None = None,
    ) -> ProviderResult:
        if self.throttled_model in params.model:
            return ProviderResult(
                outcome=Outcome.refused,
                data=None,
                message="429 quota exceeded (simulated)",
                usage=Usage(0, 0),
                model=params.model,
                latency_ms=0.1,
            )
        return await self._delegate.generate_structured(
            schema=schema, prompt=prompt, inputs=inputs, params=params, feedback=feedback
        )