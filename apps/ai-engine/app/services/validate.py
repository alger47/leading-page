"""Stage-output validation (L1/structural + stage semantic rules).

Validation issues use the stable machine-readable shape of PART VIII §8.3:
{layer, ruleId, severity, path, message, fixable, stage}. The repair ladder and
the mini-eval consume exactly this shape.
"""

from __future__ import annotations

import re
from typing import Any

from jsonschema import Draft7Validator

from app.contracts import REGISTRY_TYPES, ValidationIssue

_FORBIDDEN_HTML = re.compile(r"<[a-zA-Z/!][^>]*>|</[a-zA-Z]+>|javascript:|on\w+\s*=", re.IGNORECASE)
_URL_PREFIXES = re.compile(r"^[a-z][a-z0-9+.-]*:", re.IGNORECASE)


def validate_stage_output(
    stage: str, data: dict[str, Any], schema: dict[str, Any], context: dict[str, Any] | None = None
) -> tuple[list[ValidationIssue], bool]:
    """Return (issues, valid). valid == no errors."""
    issues: list[ValidationIssue] = []
    issues += _schema_issues(stage, data, schema)
    issues += _semantic_issues(stage, data, context or {})
    errors = [i for i in issues if i.get("severity") == "error"]
    return issues, not errors


def _schema_issues(stage: str, data: dict[str, Any], schema: dict[str, Any]) -> list[ValidationIssue]:
    out: list[ValidationIssue] = []
    validator = Draft7Validator(schema)
    for err in sorted(validator.iter_errors(data), key=lambda e: repr(e.absolute_path)):
        path = "$." + ".".join(str(p) for p in err.absolute_path) if err.absolute_path else "$"
        message = err.message
        fixable = _is_fixable(err.validator, err.message)
        out.append(
            {
                "layer": "structural",
                "ruleId": "SCHEMA",
                "severity": "error",
                "path": path,
                "message": message,
                "fixable": fixable,
                "stage": stage,
            }
        )
    return out


def _is_fixable(validator: str, message: str) -> bool:
    if validator in ("required", "type", "pattern"):
        return True
    return "is not of type" in message or "minimum" in message or "minLength" in message


def _semantic_issues(stage: str, data: dict[str, Any], ctx: dict[str, Any]) -> list[ValidationIssue]:
    if stage == "page-planner":
        return _plan_semantics(data)
    if stage == "layout-planner":
        return _layout_semantics(data, ctx.get("plan"))
    if stage == "content-generator":
        return _content_semantics(data, ctx.get("plan"), ctx.get("analysis"))
    return []


def _issue(
    rule: str, severity: str, path: str, message: str, stage: str, fixable: bool = False
) -> ValidationIssue:
    return {
        "layer": "semantic",
        "ruleId": rule,
        "severity": severity,
        "path": path,
        "message": message,
        "fixable": fixable,
        "stage": stage,
    }


def _plan_semantics(data: dict[str, Any]) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    sections = data.get("sections", [])
    types = [s.get("type") for s in sections]

    if types.count("hero") != 1:
        issues.append(_issue("SEM-001", "error", "$", "Exactly one hero required", "page-planner"))
    elif sections and sections[0].get("type") != "hero":
        issues.append(_issue("SEM-001", "error", "$", "Hero must be the first content section", "page-planner"))

    if not any(t in ("cta",) for t in types):
        issues.append(_issue("SEM-003", "error", "$", "At least one CTA section required", "page-planner"))

    if not sections or sections[-1].get("type") != "footer":
        issues.append(_issue("SEM-004", "error", "$", "Page must end with a footer", "page-planner"))

    seen: set[str] = set()
    for s in sections:
        sid = s.get("id")
        if sid is None or sid in seen:
            issues.append(_issue("SCHEMA", "error", "$", f"duplicate/empty id {sid!r}", "page-planner"))
        if sid:
            seen.add(sid)
        if s.get("type") not in REGISTRY_TYPES:
            issues.append(
                _issue("SCHEMA", "error", "$", f"type {s.get('type')!r} not in registry", "page-planner")
            )
    if not any(s.get("type") == "hero" and "title" in (s.get("slots") or {}) for s in sections):
        issues.append(_issue("SEM-002", "error", "$", "hero.title slot required", "page-planner"))
    return issues


def _layout_semantics(data: dict[str, Any], plan: dict[str, Any] | None) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    plan_ids = [s["id"] for s in (plan or {}).get("sections", [])]
    ordered = [o.get("sectionId") for o in data.get("ordering", [])]
    if sorted(ordered) != sorted(plan_ids):
        issues.append(
            _issue("SEM-007", "error", "$", "Layout ordering must cover every planned section once", "layout-planner")
        )
    if len(ordered) != len(set(ordered)):
        issues.append(_issue("SCHEMA", "error", "$", "Duplicate sectionId in ordering", "layout-planner"))
    return issues


def _content_semantics(data: dict[str, Any], plan: dict[str, Any] | None, _analysis: Any) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    planned = [s["id"] for s in (plan or {}).get("sections", [])]
    produced = [s.get("sectionId") for s in data.get("sections", [])]

    if sorted(produced) != sorted(planned):
        missing = set(planned) - set(produced)
        extra = set(produced) - set(planned)
        issues.append(
            _issue(
                "SCHEMA",
                "error",
                "$",
                f"content must match plan exactly (missing={sorted(missing)}, extra={sorted(extra)})",
                "content-generator",
            )
        )

    set_len = set(produced)
    if len(set_len) != len(produced):
        issues.append(_issue("SCHEMA", "error", "$", "Duplicate section content", "content-generator"))

    for sec in data.get("sections", []):
        content = sec.get("content") or {}
        section_path = f"$.sections[{produced.index(sec['sectionId'])}]"
        for key, value in _flatten(content):
            if isinstance(value, str) and (not value.strip()):
                issues.append(_issue("SCHEMA", "error", section_path, f"empty slot {key!r}", "content-generator"))
            if isinstance(value, str) and _FORBIDDEN_HTML.search(value):
                issues.append(
                    _issue("SCHEMA", "error", section_path, f"forbidden markup in slot {key!r}", "content-generator")
                )
        for href in _hrefs(content):
            if not href.startswith("#") or _URL_PREFIXES.match(href.split("#", 1)[1]):
                issues.append(
                    _issue("SEM-007", "error", section_path, f"non-anchor href {href!r}", "content-generator")
                )
    return issues


def _flatten(obj: Any, prefix: str = "") -> list[tuple[str, Any]]:
    out: list[tuple[str, Any]] = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            key = f"{prefix}.{k}" if prefix else k
            if isinstance(v, (dict, list)):
                out += _flatten(v, key)
            else:
                out.append((key, v))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            key = f"{prefix}[{i}]"
            if isinstance(v, (dict, list)):
                out += _flatten(v, key)
            else:
                out.append((key, v))
    else:
        out.append((prefix, obj))
    return out


def _hrefs(obj: Any) -> list[str]:
    out: list[str] = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == "href" and isinstance(v, str):
                out.append(v)
            else:
                out += _hrefs(v)
    elif isinstance(obj, list):
        for v in obj:
            out += _hrefs(v)
    return out