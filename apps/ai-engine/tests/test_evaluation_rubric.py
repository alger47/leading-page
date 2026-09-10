"""Rubric asset tests (PHASE 11)."""

from __future__ import annotations

import json

from app.evaluation.rubric import (
    RUBRICS_DIR,
    Rubric,
    load_rubric,
)

EXPECTED_CRITERION_IDS = ["structural", "coherence", "copy", "cta", "visual", "accessibility", "seo"]


def test_default_rubric_loads() -> None:
    rubric = load_rubric()
    assert isinstance(rubric, Rubric)
    assert rubric.ref == "landing-page-quality@1.0.0"


def test_default_rubric_has_all_seven_criteria() -> None:
    rubric = load_rubric()
    ids = rubric.criterion_ids()
    assert ids == EXPECTED_CRITERION_IDS


def test_criteria_are_anchored_one_to_five() -> None:
    rubric = load_rubric()
    for criterion in rubric.criteria:
        assert criterion.id in EXPECTED_CRITERION_IDS
        assert criterion.max_score == 5
        assert criterion.min_score == 1


def test_rubric_dir_contains_versioned_asset() -> None:
    path = RUBRICS_DIR / "rubric-v1.json"
    assert path.exists()
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["rubric"] == "landing-page-quality"
    assert data["version"] == "1.0.0"