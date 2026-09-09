"""SchemaBuilder unit tests — deterministic assembly of the Page Schema envelope."""

from __future__ import annotations

from app.providers.stub_data import analyze, assets, content, layout
from app.providers.stub_data import plan as stub_plan
from app.services.page_validator import validate_page
from app.services.schema_builder import assemble


def _stage_outputs(brief: str, locale: str) -> dict:
    analysis = analyze(brief, locale)
    plan = stub_plan(analysis)
    layout_plan = layout(plan, analysis)
    content_pkg = content(plan, locale, analysis["tone"], analysis)
    return {
        "analysis": analysis,
        "plan": plan,
        "layout": layout_plan,
        "content": content_pkg,
        "assets": assets(plan),
    }


def test_assemble_vet_ar_valid_and_rtl() -> None:
    out = _stage_outputs("عيادة بيطرية تقدم رعاية للقطط والكلاب.", "ar")
    schema, issues = assemble(
        plan=out["plan"],
        content=out["content"],
        layout=out["layout"],
        analysis=out["analysis"],
        job_id="job-abc",
        locale="ar",
        prompt_versions={"stage1": "1.0.0"},
        model="stub",
    )
    assert issues == []
    assert schema["schemaVersion"] == "1.0.0"
    assert schema["page"]["locale"] == "ar"
    assert schema["page"]["direction"] == "rtl"
    assert schema["theme"]["font"] == "cairo"
    assert schema["theme"]["primaryColor"] == "role:primary"
    assert schema["metadata"]["generationId"] == "job-abc"
    assert schema["assets"] == []

    hero = next(s for s in schema["sections"] if s["type"] == "hero")
    assert hero["content"]["media"]["assetRef"].startswith("asset:")
    assert "image" not in hero["content"]
    assert schema["sections"][-1]["type"] == "footer"


def test_assemble_saas_en_ltr() -> None:
    out = _stage_outputs("SaaS tool for managing your team's tasks.", "en")
    schema, _ = assemble(
        plan=out["plan"],
        content=out["content"],
        layout=out["layout"],
        analysis=out["analysis"],
        job_id="job-xyz",
        locale="en",
    )
    assert schema["page"]["direction"] == "ltr"
    assert schema["theme"]["font"] == "inter"


def test_assemble_none_optional_cta_dropped() -> None:
    out = _stage_outputs("Boutique hotel near the old town.", "en")
    plan = out["plan"]
    content_pkg = dict(out["content"])
    sections = []
    for sec in content_pkg["sections"]:
        if sec["sectionId"] == "header-1":
            sec = dict(sec)
            sec["content"] = dict(sec["content"])
            sec["content"]["navCta"] = None
        sections.append(sec)
    content_pkg["sections"] = sections

    schema, _ = assemble(plan=plan, content=content_pkg, layout=out["layout"], locale="en")
    header = next(s for s in schema["sections"] if s["type"] == "header")
    assert "navCta" not in header["content"]
    assert all(v is not None for v in header["content"].values())


def test_assemble_hero_image_slot_mapped_to_media() -> None:
    out = _stage_outputs("SaaS tool for team tasks.", "en")
    plan = out["plan"]
    content_pkg = dict(out["content"])
    content_pkg["sections"] = [dict(s) for s in content_pkg["sections"]]
    for sec in content_pkg["sections"]:
        if sec["sectionId"] == "hero-1":
            sec["content"] = {"title": "A clear value headline", "image": {"assetRef": "asset:hero-saas", "alt": "app screenshot"}}
    schema, _ = assemble(plan=plan, content=content_pkg, layout=out["layout"], locale="en")
    hero = next(s for s in schema["sections"] if s["type"] == "hero")
    assert hero["content"]["media"]["assetRef"] == "asset:hero-saas"
    assert "image" not in hero["content"]


def test_assemble_ordering_is_phase_stable() -> None:
    out = _stage_outputs("Law firm offering family law advice.", "en")
    layout_plan = dict(out["layout"])
    layout_plan["ordering"] = list(reversed(layout_plan["ordering"]))  # hostile ordering
    schema, _ = assemble(plan=out["plan"], content=out["content"], layout=layout_plan, locale="en")
    types = [s["type"] for s in schema["sections"]]
    assert types[0] == "header"
    assert types.index("hero") == 1
    assert types[-1] == "footer"
    assert len(types) == 5


def test_assemble_missing_placeholder_section_reported() -> None:
    out = _stage_outputs("Veterinary clinic for pets.", "ar")
    plan = out["plan"]
    content_pkg = dict(out["content"])
    content_pkg["sections"] = [s for s in content_pkg["sections"] if s["sectionId"] != "features-1"]
    _, issues = assemble(plan=plan, content=content_pkg, layout=out["layout"], locale="ar")
    assert any(i["code"] == "E-BUILD-002" for i in issues)


def test_assemble_page_title_falls_back_to_summary() -> None:
    out = _stage_outputs("SaaS tool for teams.", "en")
    content_pkg = dict(out["content"])
    content_pkg["sections"] = [dict(s) for s in content_pkg["sections"]]
    for sec in content_pkg["sections"]:
        if sec["sectionId"] == "hero-1":
            sec["content"] = {"primaryCta": {"label": "CTA", "href": "#cta-1"}}
    schema, issues = assemble(plan=out["plan"], content=content_pkg, layout=out["layout"], analysis=out["analysis"], locale="en")
    assert any(i["code"] == "E-BUILD-003" for i in issues)
    assert schema["page"]["title"] == out["analysis"]["summary"].rstrip(".")


def test_assemble_envelope_passes_canonical_validation(settings) -> None:
    out = _stage_outputs("عيادة بيطرية تقدم رعاية للقطط والكلاب.", "ar")
    schema, _ = assemble(plan=out["plan"], content=out["content"], layout=out["layout"], locale="ar")
    validation = validate_page(schema, envelope_path=settings.page_schema_dir / settings.envelope_schema_name)
    assert validation["valid"] is True
    assert validation["errors"] == []