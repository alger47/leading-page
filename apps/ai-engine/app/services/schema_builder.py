"""SchemaBuilder — stage 7 of the pipeline (PART VI §6.1, §6.12).

Deterministic code, never free-typed by the LLM. Merges the validated stage
outputs (BriefAnalyzer, PagePlanner, LayoutPlanner, ContentGenerator,
AssetPlanner) into the canonical Page Schema envelope (ADR-0002,
packages/page-schema/schema/envelope.schema.json).

Rules applied here (all deterministic):
  * Ordering is layout-planner driven, then made phase-stable: header block(s)
    first, the single hero immediately after, footer(s) last — so SEM-001 (hero
    first content section) and SEM-004 (ends with footer) always hold.
  * Stage slot names are mapped onto the canonical section schema slot names
    (content-generator emits hero `image`; the envelope/`hero.schema.json`
    contract names it `media`).
  * Null-valued optional slots (e.g. absent CTAs) are dropped — the canonical
    section schemas forbid null; a missing optional CTA simply renders nothing.
  * Theme is assembled from the LayoutPlanner suggestion (preset) plus locale
    defaults for the remaining Theme fields (all within the canonical enums).
  * Assets stay unresolved on purpose: PART VII AssetResolver supplies URLs in
    a later phase; sections reference assets by `asset:...` refs only.
  * Page title is derived deterministically (hero title first, then the
    BriefAnalyzer summary, then a branded placeholder) — never invented.

Assembling anomalies are reported as non-fatal `E-BUILD-0xx` diagnostics; the
envelope is still produced so editors/preview can render honestly.
"""

from __future__ import annotations

from typing import Any

SCHEMA_VERSION = "1.0.0"

LOCALE_FONTS: dict[str, str] = {"ar": "cairo", "fr": "inter", "en": "inter"}

# Rule identifiers for deterministic assembly diagnostics (documented in
# docs/ai-pipeline.md). Distinct from the AI error codes E-AI-0xx.
E_BUILD_001 = "E-BUILD-001"  # stage slot dropped/mapped (content anomaly)
E_BUILD_002 = "E-BUILD-002"  # planned section has no generated content (omitted)
E_BUILD_003 = "E-BUILD-003"  # page title derived via fallback

ANCHOR_TYPES = ("header", "hero", "footer")


def direction_for_locale(locale: str) -> str:
    """Direction derives from the locale (PART V §5.4) — never guessed from content."""
    return "rtl" if locale == "ar" else "ltr"


def font_for_locale(locale: str) -> str:
    return LOCALE_FONTS.get(locale, "inter")


def _pop_nulls(content: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in content.items() if v is not None}


def _clean_hero(content: dict[str, Any], issues: list[dict[str, Any]], section_id: str) -> dict[str, Any]:
    cleaned = _pop_nulls(content)
    if "image" in cleaned and "media" not in cleaned:
        cleaned["media"] = cleaned.pop("image")
        if cleaned.get("media") is None:
            cleaned.pop("media", None)
    else:
        cleaned.pop("image", None)
    if "media" in cleaned and "assetRef" in cleaned["media"]:
        alt = cleaned["media"].get("alt")
        if not alt:
            # MediaRef.alt is required (a11y, §5.8) — never emit an empty alt.
            cleaned["media"]["alt"] = str(cleaned.get("title") or "Image for this section")
            issues.append(
                {
                    "code": E_BUILD_001,
                    "section": section_id,
                    "message": "hero media slot missing localized alt; derived from title.",
                }
            )
    return cleaned


def clean_section_content(
    section_type: str, content: dict[str, Any], *, section_id: str, issues: list[dict[str, Any]]
) -> dict[str, Any]:
    """Map stage slot names onto canonical section schema slots and drop nulls.

    Only slot *shape* is retouched here — text is never rewritten.
    """
    if not isinstance(content, dict):
        issues.append({"code": E_BUILD_001, "section": section_id, "message": "section content is not an object."})
        return {}
    if section_type == "hero":
        return _clean_hero(content, issues, section_id)
    return _pop_nulls(content)


def _order_sections(
    plan_sections: list[dict[str, Any]], ordering: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Layout order, then phase-stable anchors: header(s), hero, rest, footer(s)."""
    order_map: dict[str, int] = {}
    for entry in ordering:
        if isinstance(entry, dict) and "sectionId" in entry:
            value = entry.get("order")
            if isinstance(value, int):
                order_map[str(entry["sectionId"])] = value
    plan_index = {s.get("id"): i for i, s in enumerate(plan_sections) if s.get("id")}

    def key(section: dict[str, Any]) -> tuple[int, int]:
        sid = section.get("id", "")
        return (order_map.get(sid, 2**31), plan_index.get(sid, 2**31))

    ordered = sorted(plan_sections, key=key)
    headers = [s for s in ordered if s.get("type") == "header"]
    heroes = [s for s in ordered if s.get("type") == "hero"]
    footers = [s for s in ordered if s.get("type") == "footer"]
    rest = [s for s in ordered if s.get("type") not in ANCHOR_TYPES]
    return headers + heroes + rest + footers


def _build_sections(
    plan: dict[str, Any],
    content_pkg: dict[str, Any],
    layout: dict[str, Any],
    issues: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    plan_sections = plan.get("sections", []) if isinstance(plan, dict) else []
    content_by_id: dict[str, dict[str, Any]] = {}
    for entry in (content_pkg.get("sections", []) if isinstance(content_pkg, dict) else []):
        if isinstance(entry, dict) and entry.get("sectionId"):
            content_by_id[str(entry["sectionId"])] = entry.get("content", {})

    hints = layout.get("layoutHints", {}) if isinstance(layout, dict) else {}
    if not isinstance(hints, dict):
        hints = {}

    ordered = _order_sections(plan_sections, layout.get("ordering", []) if isinstance(layout, dict) else [])

    sections: list[dict[str, Any]] = []
    for sec in ordered:
        if not isinstance(sec, dict):
            continue
        sec_id = sec.get("id")
        sec_type = sec.get("type")
        if not sec_id or not sec_type:
            continue
        raw = content_by_id.get(sec_id)
        if raw is None:
            issues.append(
                {"code": E_BUILD_002, "section": str(sec_id), "message": "planned section has no generated content."}
            )
            continue
        content = clean_section_content(str(sec_type), raw, section_id=str(sec_id), issues=issues)
        section: dict[str, Any] = {
            "id": str(sec_id),
            "type": str(sec_type),
            "variant": str(sec.get("variant") or "default"),
            "content": content,
        }
        hint = hints.get(sec_id)
        if isinstance(hint, dict):
            layout_hint: dict[str, Any] = {}
            for key in ("mediaSide", "columns", "align"):
                if hint.get(key) is not None:
                    layout_hint[key] = hint[key]
            if layout_hint:
                section["layoutHint"] = layout_hint
        sections.append(section)
    return sections


def _derive_page_title(
    sections: list[dict[str, Any]], analysis: dict[str, Any] | None, issues: list[dict[str, Any]]
) -> str:
    hero = next((s for s in sections if s.get("type") == "hero"), None)
    if hero:
        title = (hero.get("content") or {}).get("title")
        if isinstance(title, str) and title.strip():
            return title.strip()
    if isinstance(analysis, dict) and analysis.get("summary"):
        fallback = str(analysis["summary"]).rstrip(".")
        issues.append({"code": E_BUILD_003, "section": "-", "message": "page title derived from the brief summary."})
        return fallback
    issues.append({"code": E_BUILD_003, "section": "-", "message": "page title is a branded placeholder."})
    return "[Business name]"


def _build_theme(layout: dict[str, Any], locale: str) -> dict[str, Any]:
    preset = layout.get("theme") if isinstance(layout, dict) else None
    if preset not in ("warm-professional", "cool-modern", "bold-creative", "minimal-clean"):
        preset = "warm-professional"
    return {
        "preset": preset,
        "font": font_for_locale(locale),
        "primaryColor": "role:primary",
        "radius": "medium",
        "density": "comfortable",
    }


def assemble(
    *,
    plan: dict[str, Any],
    content: dict[str, Any],
    layout: dict[str, Any],
    analysis: dict[str, Any] | None = None,
    job_id: str = "job-unknown",
    locale: str = "en",
    prompt_versions: dict[str, str] | None = None,
    model: str = "stub",
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Build the Page Schema envelope from stage outputs.

    Returns ``(schema, build_issues)``. ``schema`` is always produced; it must
    then be passed through :func:`app.services.page_validator.validate_page`
    for canonical L1 + L2 checks.
    """
    issues: list[dict[str, Any]] = []
    sections = _build_sections(plan, content, layout, issues)
    title = _derive_page_title(sections, analysis, issues)

    schema: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "page": {
            "title": title,
            "locale": locale,
            "direction": direction_for_locale(locale),
        },
        "theme": _build_theme(layout, locale),
        "sections": sections,
        "assets": [],
        "metadata": {
            "generationId": job_id,
            "promptVersions": dict(prompt_versions or {}),
            "model": model,
        },
    }
    return schema, issues