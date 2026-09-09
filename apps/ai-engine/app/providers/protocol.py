"""Provider abstraction (PART VI §6.2).

A StructuredLLMProvider is the ONLY way business code talks to an LLM.
Provider SDK calls scattered through pipeline code are forbidden.
Implementations: stub (tests/dev), openai/anthropic (real HTTP structured output).
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from pydantic import BaseModel

from app.contracts import Outcome, Usage
from app.prompts.assets import PromptAsset


class GenerationParams(BaseModel):
    model: str
    temperature: float = 0.0
    max_output_tokens: int = 2048


class ProviderResult(BaseModel):
    outcome: Outcome
    data: dict[str, Any] | None = None
    message: str = ""
    usage: Usage
    model: str = ""
    latency_ms: float = 0.0
    # Raw provider payload (for future evaluation/telmetry), PII-free.
    raw: dict[str, Any] | None = None


@runtime_checkable
class StructuredLLMProvider(Protocol):
    name: str

    async def generate_structured(
        self,
        *,
        schema: dict[str, Any],
        prompt: PromptAsset,
        inputs: dict[str, Any],
        params: GenerationParams,
        feedback: str | None = None,
    ) -> ProviderResult:
        """One bounded generation call bound to the stage's JSON Schema.

        Returns a ProviderResult with outcome one of:
        ok | malformed | refused | timeout | provider_error.
        """
        ...