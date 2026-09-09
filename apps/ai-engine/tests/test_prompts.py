"""Prompt registry + JSON Schema store (ADR-0002)."""

from __future__ import annotations

import pytest

from app.core.errors import RoutingConfigError
from app.prompts.assets import PromptAsset


def test_registry_loads_all_five_versioned_assets(container) -> None:
    names = container.prompts.names()
    assert set(names) == {
        "stage1-brief-analyzer",
        "stage2-page-planner",
        "stage3-layout-planner",
        "stage4-content-generator",
        "stage5-asset-planner",
    }
    refs = container.prompts.refs()
    assert all("@1.0.0" in ref for ref in refs)


def test_schemas_count_matches_stages(container) -> None:
    assert container.schemas.count() == 5
    content_schema = container.schemas.load_by_stage("content-generator")
    assert content_schema["type"] == "object"
    assert "sections" in content_schema["properties"]


def test_unknown_prompt_raises_e_ai_006(container) -> None:
    with pytest.raises(RoutingConfigError) as exc:
        container.prompts.get("stage9-nonexistent")
    assert "E-AI-006" in str(exc.value)


def test_render_substitutes_slots_and_preserves_literal_braces() -> None:
    asset = PromptAsset.from_yaml(
        """
name: stage2-page-planner
version: 1.0.0
model_class: fast
temperature: 0
inputs_schema: page_planner.input.json
output_schema: page_planner.output.json
system: You plan landing pages.
user_template: |
  Use a JSON object with fields like {id, type, variant} for sections.
  Here is the analysis: {analysis}
few_shot: []
"""
    )
    rendered = asset.render(inputs={"analysis": {"vertical": "hotel"}})
    assert "fields like {id, type, variant}" in rendered
    assert '{"vertical": "hotel"}' in rendered


def test_render_missing_slot_raises() -> None:
    asset = PromptAsset.from_yaml(
        """
name: stage1-brief-analyzer
version: 1.0.0
model_class: fast
temperature: 0
inputs_schema: brief_analyzer.input.json
output_schema: brief_analyzer.output.json
system: sys
user_template: "Analyze {brief} for {locale}"
few_shot: []
"""
    )
    with pytest.raises(KeyError):
        asset.render(inputs={"brief": "x"})