"""Stub LLM provider — deterministic, offline (tests, dev, CI, mini-eval).

Behavior mirrors a "perfect" model so the pipeline machinery (routing, repair
ladder, ledger, budget controls, injection handling) is fully exercised
without network or cost. Outputs are valid by construction.
"""

from __future__ import annotations

import base64
import json
import time
from typing import Any

from app.contracts import Outcome, Usage
from app.prompts.assets import PromptAsset
from app.providers import stub_data
from app.providers.protocol import GenerationParams, ImageResult, ProviderResult

# 1x1 transparent PNG — deterministic, valid, offline (tests/dev/CI). Mirrors a
# "perfect" image model so the asset-renderer machinery is fully exercised.
_STUB_PNG_BYTES = bytes(
    base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )
)

_STAGE_BUILDERS: dict[str, Any] = {
    "stage1-brief-analyzer": lambda inputs: stub_data.analyze(inputs["brief"], inputs["locale"]),
    "stage2-page-planner": lambda inputs: stub_data.plan(inputs["analysis"]),
    "stage3-layout-planner": lambda inputs: stub_data.layout(inputs["plan"], inputs["analysis"]),
    "stage4-content-generator": lambda inputs: stub_data.content(
        inputs["plan"], inputs["locale"], inputs["tone"], inputs["analysis"]
    ),
    "stage5-asset-planner": lambda inputs: stub_data.assets(inputs["plan"]),
}


class StubImageProvider:
    """Deterministic offline image provider (tests/dev/CI)."""

    name = "stub"

    async def generate(self, *, prompt: str, size: str) -> ImageResult:
        return ImageResult(
            ok=True,
            data=bytes(_STUB_PNG_BYTES),
            mime="image/png",
            message="ok",
            model=f"stub-image:{size}",
            latency_ms=0.1,
        )


class StubProvider:
    """Deterministic provider. Same prompt + inputs ⇒ same output every time."""

    name = "stub"

    def __init__(self, *, seed: int = 0) -> None:
        self.seed = seed

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
        data = _build(prompt.name, inputs)
        usage = _usage(prompt, inputs, data)
        latency_ms = (time.perf_counter() - started) * 1000.0
        return ProviderResult(
            outcome=Outcome.ok,
            data=data,
            message="ok",
            usage=usage,
            model=params.model,
            latency_ms=latency_ms,
        )


def _build(prompt_name: str, inputs: dict[str, Any]) -> dict[str, Any]:
    builder = _STAGE_BUILDERS.get(prompt_name)
    if builder is None:
        raise ValueError(f"stub has no builder for prompt {prompt_name!r}")
    return builder(inputs)


def _usage(prompt: PromptAsset, inputs: dict[str, Any], data: dict[str, Any]) -> Usage:
    input_chars = len(prompt.system) + len(prompt.render(inputs))
    output_chars = len(json.dumps(data, ensure_ascii=False))
    return Usage(input_tokens=max(32, input_chars // 4), output_tokens=max(16, output_chars // 3))