"""Page validator unit tests — L1 envelope (canonical schema) + L2 SEM mirror."""

from __future__ import annotations

from app.services.page_validator import (
    PageValidationError,
    validate_page,
    validate_semantic,
    validate_structural,
)
from app.services.schema_builder import SCHEMA_VERSION


def _section(sid: str, stype: str, content: dict | None = None) -> dict:
    return {"id": sid, "type": stype, "variant": "default", "content": content or {}}


def _schema(sections: list[dict]) -> dict:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "page": {"title": "Modern clinic you can trust", "locale": "en", "direction": "ltr"},
        "theme": {"preset": "warm-professional", "font": "inter", "primaryColor": "role:primary", "radius": "medium", "density": "comfortable"},
        "sections": sections,
    }


def test_sem_001_no_hero() -> None:
    schema = _schema([_section("header-1", "header"), _section("features-1", "features")])
    issues = validate_semantic(schema)
    assert any(i["ruleId"] == "SEM-001" and i["severity"] == "error" for i in issues)


def test_sem_001_multiple_heroes() -> None:
    schema = _schema([_section("hero-1", "hero"), _section("hero-2", "hero")])
    issues = validate_semantic(schema)
    assert any("Expected exactly 1 hero" in i["message"] for i in issues)


def test_sem_001_hero_not_first_content() -> None:
    schema = _schema([_section("header-1", "header"), _section("features-1", "features", {"primaryCta": {"label": "x", "href": "#y"}}), _section("hero-1", "hero")])
    issues = validate_semantic(schema)
    assert any("Hero must be the first content section" in i["message"] for i in issues)


def test_sem_002_title_word_count() -> None:
    schema = _schema(
        [_section("hero-1", "hero", {"title": "This title is much too long and has far more than fourteen words in it indeed"})]
    )
    issues = validate_semantic(schema)
    assert any(i["ruleId"] == "SEM-002" for i in issues)


def test_sem_003_no_cta_in_first_two_content() -> None:
    schema = _schema(
        [
            _section("header-1", "header"),
            _section("hero-1", "hero", {"title": "A valid headline"}),
            _section("features-1", "features", {"title": "Plain features"}),
        ]
    )
    issues = validate_semantic(schema)
    assert any(i["ruleId"] == "SEM-003" for i in issues)


def test_sem_004_missing_footer() -> None:
    schema = _schema([_section("hero-1", "hero", {"title": "A valid headline", "primaryCta": {"label": "x", "href": "#y"}})])
    issues = validate_semantic(schema)
    assert any(i["ruleId"] == "SEM-004" for i in issues)


def test_structural_passes_and_fails_on_canonical_envelope(settings) -> None:
    envelope = settings.page_schema_dir / settings.envelope_schema_name
    good = _schema([_section("hero-1", "hero", {"title": "A valid headline", "primaryCta": {"label": "x", "href": "#y"}})])
    assert validate_structural(good, envelope_path=envelope) == []
    bad = {"sections": 5}
    issues = validate_structural(bad, envelope_path=envelope)
    assert issues and issues[0]["ruleId"] == "E-VAL-STRUCT-001"


def test_validate_page_aggregates_layers(settings) -> None:
    envelope = settings.page_schema_dir / settings.envelope_schema_name
    result = validate_page({"sections": 5}, envelope_path=envelope)
    assert result["valid"] is False
    assert result["errors"]
    assert result["issues"]


def test_missing_canonical_schema_raises(tmp_path, settings) -> None:
    try:
        validate_structural(_schema([]), envelope_path=tmp_path / "nope.json")
        raise AssertionError("expected PageValidationError")
    except PageValidationError:
        pass