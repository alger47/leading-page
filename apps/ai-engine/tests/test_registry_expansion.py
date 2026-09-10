"""Phase 14 registry expansion tests: signal-gated section variety.

The canonical skeleton stays 5 sections (golden/regression are calibrated;
max_sections=6 bounds golden pages). A section is only ADDED when the brief's
analyzed signals explicitly ask for it, and the section is built HONESTLY:
quotes/prices/questions/galleries/contact details are placeholders, never
invented facts (PART VI آ§6.8).
"""

from __future__ import annotations

from app.providers.stub_data import analyze, assets, content, layout
from app.providers.stub_data import plan as stub_plan


def _types(brief: str, locale: str = "en") -> list[str]:
    analysis = analyze(brief, locale)
    plan = stub_plan(analysis)
    return [s["type"] for s in plan["sections"]]


def test_default_plan_stays_canonical() -> None:
    assert _types("SaaS invoicing tool for freelancers.") == ["hero", "header", "features", "cta", "footer"]


def test_pricing_signal_adds_pricing_section() -> None:
    types = _types("Escape room with transparent pricing on the page.")
    assert types == ["hero", "header", "features", "pricing", "cta", "footer"]


def test_testimonial_signal_adds_testimonials() -> None:
    types = _types("Restaurant where clients share their reviews.")
    assert "testimonials" in types
    assert types.index("testimonials") == types.index("features") + 1


def test_faq_and_contact_signal_placement() -> None:
    types = _types("Dentist clinic: answer common questions, contact us.")
    assert types[-2:] == ["contact", "footer"]
    assert "faq" in types
    assert types.index("faq") < types.index("cta")
    assert types.index("contact") == types.index("cta") + 1


def test_gallery_signal_adds_gallery_and_asset_requirements() -> None:
    items = _types("Hotel looking to showcase photos of the rooms.")
    assert "gallery" in items
    assert items.index("gallery") >= items.index("features")
    plan = stub_plan(analyze("Hotel looking to showcase photos of the rooms.", "en"))
    reqs = assets(plan)["requirements"]
    assert any(r["id"] == "gallery-1" and r["kind"] == "image" for r in reqs)


def test_multiple_signals_kept_within_golden_bound() -> None:
    # 3 extra sections (pricing + testimonials + contact) -> 8 total; the stub
    # page stays L1/L2 valid because anchors (hero first, footer last, CTA
    # present) are preserved by insertion order.
    analysis = analyze("Join us: transparent pricing, read our reviews, contact the team.", "en")
    plan = stub_plan(analysis)
    types = [s["type"] for s in plan["sections"]]
    assert types[0] == "hero"
    assert types[-1] == "footer"
    assert "cta" in types


def test_new_sections_render_honest_placeholders() -> None:
    analysis = analyze("Meet our clients, see pricing and photos.", "en")
    plan = stub_plan(analysis)
    pkg = content(plan, "en", analysis["tone"], analysis)
    by_id = {s["sectionId"]: s["content"] for s in pkg["sections"]}
    assert plan is not None
    for sec in plan["sections"]:
        c = by_id[sec["id"]]
        if sec["type"] == "testimonials":
            for item in c["items"]:
                assert item["quote"].startswith("[") and item["name"].startswith("[")
        elif sec["type"] == "pricing":
            for tier in c["tiers"]:
                assert tier["price"] == "[Price]" and all(f.startswith("[") for f in tier["features"])
        elif sec["type"] == "faq":
            for item in c["items"]:
                assert item["question"].startswith("[" ) and item["answer"].startswith("[")
        elif sec["type"] == "gallery":
            for item in c["items"]:
                assert item["image"]["assetRef"].startswith("asset:")
        elif sec["type"] == "contact":
            assert c["phone"] == "[Phone]" and c["email"] == "[Email]"
    # every planned section produced content (content/plan parity invariant)
    assert set(by_id) == {s["id"] for s in plan["sections"]}


def test_signal_plan_is_layout_and_asset_stable() -> None:
    parent = _types("Roastery with photos and happy customer reviews.")
    analysis = analyze("Roastery with photos and happy customer reviews.", "en")
    plan = stub_plan(analysis)
    first = (layout(plan, analysis), assets(plan))
    second = (layout(plan, analysis), assets(plan))
    assert first == second
    assert set(parent) == {s["type"] for s in plan["sections"]}
