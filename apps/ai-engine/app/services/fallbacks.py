"""Stage fallbacks (PART VI §6.5): deterministic default plans/content.

Used only after the repair ladder is exhausted. The data is clearly marked
draft; the job still fails honestly (E-AI-004) — a fallback is never presented
as an AI success (PD-05).
"""

from __future__ import annotations

from typing import Any

from app.providers import stub_data


def default_stage_data(stage: str, inputs: dict[str, Any]) -> dict[str, Any]:
    if stage == "brief-analyzer":
        brief = inputs.get("brief", "")
        locale = inputs.get("locale", "en")
        return stub_data.analyze(brief, locale)
    if stage == "page-planner":
        analysis = inputs.get("analysis") or {}
        return stub_data.plan(analysis)
    if stage == "layout-planner":
        return stub_data.layout(inputs.get("plan") or {}, inputs.get("analysis") or {})
    if stage == "content-generator":
        return stub_data.content(inputs.get("plan") or {}, inputs.get("locale", "en"), inputs.get("tone", "warm-professional"), inputs.get("analysis") or {})
    if stage == "asset-planner":
        return stub_data.assets(inputs.get("plan") or {})
    raise ValueError(f"no fallback for unknown stage {stage!r}")