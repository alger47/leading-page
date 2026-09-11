"""Shared data contracts for the AI Engine pipeline.

These mirror the Master Prompt's GenerationAttempt / GenerationJob entities
(PART X §10.2). Persistence to PostgreSQL is deferred to Phase 6; in Phase 4
the ledger lives in memory inside a job run.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Literal

# One validation finding, in the stable machine-readable shape of PART VIII §8.3.
ValidationIssue = dict[str, Any]

LOCALES = Literal["ar", "fr", "en"]
TONES = Literal["warm-professional", "cool-modern", "bold-creative", "minimal-clean", "friendly-casual"]

# Registry types — must stay in lockstep with packages/ui-components registry
# (CI drift check covers the TS side; keep this constant in sync).
REGISTRY_TYPES: tuple[str, ...] = (
    "header",
    "hero",
    "features",
    "testimonials",
    "pricing",
    "faq",
    "gallery",
    "contact",
    "cta",
    "footer",
)


class Outcome(str, Enum):
    """Per-attempt outcome (PART VI §6.2)."""
    ok = "ok"
    malformed = "malformed"
    refused = "refused"
    timeout = "timeout"
    provider_error = "provider_error"


@dataclass(frozen=True)
class Usage:
    input_tokens: int
    output_tokens: int

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens


@dataclass
class GenerationAttempt:
    """One provider call record (GenerationAttempt entity, in-memory for Phase 4)."""
    stage: str
    attempt_number: int
    prompt_ref: str  # name@version
    model_class: str
    provider: str
    model_id: str
    usage: Usage
    cost_usd: float
    latency_ms: float
    outcome: Outcome
    validation_issues: list[ValidationIssue] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "stage": self.stage,
            "attempt": self.attempt_number,
            "prompt": self.prompt_ref,
            "model_class": self.model_class,
            "provider": self.provider,
            "model": self.model_id,
            "tokens_in": self.usage.input_tokens,
            "tokens_out": self.usage.output_tokens,
            "cost_usd": round(self.cost_usd, 6),
            "latency_ms": round(self.latency_ms, 1),
            "outcome": self.outcome.value,
            "issues": self.validation_issues,
        }


@dataclass
class StageResult:
    stage: str
    ok: bool
    data: dict[str, Any] | None = None
    attempts: list[GenerationAttempt] = field(default_factory=list)
    issues: list[ValidationIssue] = field(default_factory=list)
    fallback_used: bool = False
    repaired: bool = False
    draft: bool = False
    error_code: str | None = None

    @property
    def attempts_count(self) -> int:
        return len(self.attempts)

    @property
    def cost_usd(self) -> float:
        return sum(a.cost_usd for a in self.attempts)

    def to_dict(self) -> dict[str, Any]:
        stage: dict[str, Any] = {
            "stage": self.stage,
            "ok": self.ok,
            "attempts": self.attempts_count,
            "fallback_used": self.fallback_used,
            "repaired": self.repaired,
            "draft": self.draft,
            "error_code": self.error_code,
            "cost_usd": round(self.cost_usd, 6),
            "issues": self.issues,
        }
        # The brief-analysis output is small and drives honest UX signals
        # (vertical / tone / has_enough_facts); surface it so the worker can
        # relay it into job events. Other stage payloads stay internal.
        if self.stage == "brief-analyzer" and self.data is not None:
            stage["data"] = self.data
        return stage


# Stages that decide what the visitor reads; if any of them succeeded through a
# non-stub provider the page is LLM-generated, otherwise it is deterministic.
_CONTENT_STAGES: tuple[str, ...] = ("page-planner", "layout-planner", "content-generator")


def generation_mode_for(result, routing) -> str:
    """`llm` when a content-producing stage succeeded through a model class whose
    configured provider is not the deterministic stub; else `stub`. Resolution goes
    through the routing table (the attempt's own `provider` field records the model
    id, not the vendor) so the web's demo-mode disclosure stays honest."""
    for stage in result.stages:
        if stage.stage not in _CONTENT_STAGES:
            continue
        for attempt in stage.attempts:
            if attempt.outcome is not Outcome.ok:
                continue
            try:
                provider = routing.model(attempt.model_class).provider
            except Exception:
                continue
            if provider != "stub":
                return "llm"
    return "stub"


@dataclass
class JobResult:
    job_id: str
    status: Literal["RUNNING", "COMPLETED", "FAILED"]
    stages: list[StageResult] = field(default_factory=list)
    brief_flags: dict[str, Any] = field(default_factory=dict)
    error_code: str | None = None
    error_message: str | None = None
    start_ms: int = 0
    end_ms: int = 0
    page: dict[str, Any] | None = None
    page_validation: dict[str, Any] | None = None
    build_issues: list[ValidationIssue] = field(default_factory=list)

    @property
    def total_attempts(self) -> int:
        return sum(s.attempts_count for s in self.stages)

    @property
    def total_cost_usd(self) -> float:
        return sum(s.cost_usd for s in self.stages)

    @property
    def data(self) -> dict[str, Any]:
        """Merged stage outputs keyed by stage name (used by orchestrators/UI)."""
        return {s.stage: s.data for s in self.stages if s.data is not None}

    def validation_summary(self) -> dict[str, Any]:
        errors = sum(len([i for i in s.issues if i.get("severity") == "error"]) for s in self.stages)
        warnings = sum(len([i for i in s.issues if i.get("severity") == "warning"]) for s in self.stages)
        return {"errors": errors, "warnings": warnings}

    def to_dict(self) -> dict[str, Any]:
        return {
            "job_id": self.job_id,
            "status": self.status,
            "error_code": self.error_code,
            "error_message": self.error_message,
            "brief_flags": self.brief_flags,
            "stages": [s.to_dict() for s in self.stages],
            "ledger": {
                "attempts": self.total_attempts,
                "cost_usd": round(self.total_cost_usd, 6),
                "duration_ms": self.end_ms - self.start_ms,
                "attempts_detail": [a.to_dict() for s in self.stages for a in s.attempts],
            },
            "validation": self.validation_summary(),
            "page": self.page,
            "page_validation": self.page_validation,
            "build_issues": self.build_issues,
            "headers_preview": {s.stage: (s.data.get("title", "") if s.data else "") for s in self.stages},
        }