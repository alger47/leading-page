"""Page Schema validation for the AI engine (PART VIII §8.1–8.3).

Layer 1 mirrors packages/page-schema `validateStructural` against the CANONICAL
envelope.schema.json (ADR-0002 single source of truth — the engine reads the
file, never a copy).
Layer 2 mirrors packages/page-schema `validateSemantic` (SEM-001..004) in Python
so engine-side mini-eval can measure page validity without importing the TS
package. The TS validators remain authoritative at render/publish time (§8.2).

Issue shape follows §8.3 and matches the engine's ValidationIssue contract:
``{layer, ruleId, severity, path, message}``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from jsonschema import Draft7Validator

ValidationIssue = dict[str, Any]


class PageValidationError(RuntimeError):
    """Raised when the canonical envelope schema cannot be loaded (E-BUILD-004)."""


def _issue(layer: str, rule_id: str, severity: str, path: str, message: str) -> ValidationIssue:
    return {
        "layer": layer,
        "ruleId": rule_id,
        "severity": severity,
        "path": path,
        "message": message,
    }


def validate_structural(schema: dict[str, Any], *, envelope_path: Path) -> list[ValidationIssue]:
    """L1 against the canonical envelope schema (mirrors E-VAL-STRUCT-001)."""
    envelope_path = Path(envelope_path)
    if not envelope_path.exists():
        raise PageValidationError(f"canonical envelope schema not found: {envelope_path}")
    validator = Draft7Validator(json.loads(envelope_path.read_text(encoding="utf-8")))
    errors = sorted(validator.iter_errors(schema), key=lambda e: list(e.absolute_path))
    return [
        _issue("structural", "E-VAL-STRUCT-001", "error", _json_path(error), error.message)
        for error in errors
    ]


def _json_path(error: Any) -> str:
    parts = list(error.absolute_path)
    if not parts:
        return "/"
    path = "$"
    for part in parts:
        if isinstance(part, int):
            path += f"[{part}]"
        else:
            path += f".{part}"
    return path


def _word_count(text: str) -> int:
    return len(text.strip().split())


def validate_semantic(schema: dict[str, Any]) -> list[ValidationIssue]:
    """L2 mirror of packages/page-schema validateSemantic (SEM-001..004)."""
    issues: list[ValidationIssue] = []
    sections = schema.get("sections", [])
    if not isinstance(sections, list):
        sections = []

    content_sections = [s for s in sections if s.get("id") not in ("header-1", "footer-1")]
    hero_sections = [s for s in content_sections if s.get("type") == "hero"]

    # SEM-001: exactly one hero; hero is the first content section.
    if not hero_sections:
        issues.append(_issue("semantic", "SEM-001", "error", "$.sections", "No hero section found"))
    elif len(hero_sections) > 1:
        issues.append(
            _issue("semantic", "SEM-001", "error", "$.sections", f"Expected exactly 1 hero section, found {len(hero_sections)}")
        )
    if content_sections and content_sections[0].get("type") != "hero":
        issues.append(_issue("semantic", "SEM-001", "error", "$.sections[0]", "Hero must be the first content section"))

    # SEM-002: hero.title non-empty, 2-14 words.
    hero = next((s for s in sections if s.get("type") == "hero"), None)
    if hero:
        title = (hero.get("content") or {}).get("title")
        if not title or not str(title).strip():
            issues.append(
                _issue("semantic", "SEM-002", "error", '$.sections[?(@.type=="hero")].content.title', "Hero title must not be empty")
            )
        else:
            count = _word_count(str(title))
            if count < 2 or count > 14:
                issues.append(
                    _issue(
                        "semantic",
                        "SEM-002",
                        "error",
                        '$.sections[?(@.type=="hero")].content.title',
                        f"Hero title must be 2-14 words, found {count}",
                    )
                )

    # SEM-003: >= 1 actionable CTA within the first two content sections.
    has_cta = False
    for section in content_sections[:2]:
        content = section.get("content") or {}
        if content.get("primaryCta") or content.get("secondaryCta") or content.get("navCta"):
            has_cta = True
            break
    if not has_cta:
        issues.append(_issue("semantic", "SEM-003", "error", "$.sections[0..1]", "No actionable CTA in the first two content sections"))

    # SEM-004: page ends with a footer.
    last = sections[-1] if sections else None
    if not last or last.get("type") != "footer":
        issues.append(_issue("semantic", "SEM-004", "error", "$.sections", "Page must end with a footer section"))

    return issues


def validate_page(schema: dict[str, Any], *, envelope_path: Path) -> dict[str, Any]:
    """Full engine-side page check: L1 structural + L2 semantic.

    Returns ``{valid, errors, warnings, issues}``.
    """
    errors: list[ValidationIssue] = []
    warnings: list[ValidationIssue] = []
    errors.extend(validate_structural(schema, envelope_path=envelope_path))
    errors.extend(validate_semantic(schema))
    issues = errors + warnings
    return {
        "valid": not errors,
        "errors": errors,
        "warnings": warnings,
        "issues": issues,
    }


def errors_count(validation: dict[str, Any]) -> int:
    return len(validation.get("errors", []))


def warnings_count(validation: dict[str, Any]) -> int:
    return len(validation.get("warnings", []))