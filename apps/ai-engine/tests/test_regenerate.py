"""Section-level regeneration (Phase 8, J2): the ONLY changed slot is the
target section's content; everything else stays byte-identical."""

from __future__ import annotations

import asyncio

from app.services.regenerate import E_REGEN_NOT_FOUND, E_VAL_L1


async def _make_page(container) -> dict:
    job = await container.pipeline.run(brief="SaaS tool for team tasks.", locale="en", job_id="regen-source")
    assert job.status == "COMPLETED"
    assert job.page is not None and job.page_validation and job.page_validation["valid"]
    return job.page


def test_regen_keeps_every_other_section_byte_identical(container) -> None:
    async def scenario() -> None:
        source = await _make_page(container)
        hero_id = next(s["id"] for s in source["sections"] if s["type"] == "hero")

        job = await container.regenerator.run(
            job_id="regen-hero-1",
            brief="SaaS tool for team tasks.",
            page=source,
            target_section_id=hero_id,
            locale="en",
        )
        assert job.status == "COMPLETED", job.error_message
        assert job.error_code is None
        assert job.page_validation is not None and job.page_validation["valid"] is True

        updated = job.page
        for original, rebuilt in zip(source["sections"], updated["sections"]):
            if original["id"] == hero_id:
                continue
            assert original == rebuilt, f"non-target section {original['id']} changed"
        # id/type/variant/layoutHint of the target itself are preserved
        target_orig = next(s for s in source["sections"] if s["id"] == hero_id)
        target_new = next(s for s in updated["sections"] if s["id"] == hero_id)
        assert target_new["id"] == target_orig["id"]
        assert target_new["type"] == target_orig["type"]
        assert target_new["variant"] == target_orig["variant"]

    asyncio.run(scenario())


def test_regen_reports_honest_failure_for_unknown_section(container) -> None:
    async def scenario() -> None:
        source = await _make_page(container)
        job = await container.regenerator.run(
            job_id="regen-missing",
            brief="SaaS tool for team tasks.",
            page=source,
            target_section_id="hero-nope",
            locale="en",
        )
        assert job.status == "FAILED"
        assert job.error_code == E_REGEN_NOT_FOUND
        assert "hero-nope" in (job.error_message or "")

    asyncio.run(scenario())


def test_regen_fails_honestly_for_invalid_source_document(container) -> None:
    async def scenario() -> None:
        job = await container.regenerator.run(
            job_id="regen-bad-source",
            brief="x",
            page={"schemaVersion": "1.0.0", "page": {"title": "x"}, "theme": {}, "sections": []},
            target_section_id="hero-01",
            locale="en",
        )
        assert job.status == "FAILED"
        assert job.error_code == E_VAL_L1

    asyncio.run(scenario())


def test_regenerate_section_endpoint_returns_spliced_page(client, auth_headers) -> None:
    source = client.post("/internal/v1/generate", headers=auth_headers, json={"brief": "Hotel near the old town.", "locale": "en"})
    assert source.status_code == 200
    page = source.json()["job"]["page"]
    hero_id = next(s["id"] for s in page["sections"] if s["type"] == "hero")
    cta_id = next(s["id"] for s in page["sections"] if s["type"] == "cta")

    resp = client.post(
        "/internal/v1/regenerate-section",
        headers=auth_headers,
        json={"brief": "Hotel near the old town.", "target_section_id": hero_id, "page": page, "locale": "en", "job_id": "regen-ep-1"},
    )
    assert resp.status_code == 200
    job = resp.json()["job"]
    assert job["status"] == "COMPLETED"
    assert job["page_validation"]["valid"] is True
    updated = job["page"]
    assert [s["id"] for s in updated["sections"]] == [s["id"] for s in page["sections"]]
    assert updated["sections"][page["sections"].index(next(s for s in page["sections"] if s["id"] == cta_id))] == next(
        s for s in page["sections"] if s["id"] == cta_id
    )
    assert updated["sections"][page["sections"].index(next(s for s in page["sections"] if s["id"] == hero_id))]["id"] == hero_id


def test_regenerate_section_endpoint_rejects_unknown_section(client, auth_headers) -> None:
    source = client.post("/internal/v1/generate", headers=auth_headers, json={"brief": "Gym in the city center.", "locale": "fr"})
    page = source.json()["job"]["page"]
    resp = client.post(
        "/internal/v1/regenerate-section",
        headers=auth_headers,
        json={"brief": "Gym in the city center.", "target_section_id": "missing-1", "page": page, "locale": "fr"},
    )
    assert resp.status_code == 200
    assert resp.json()["job"]["status"] == "FAILED"
    assert resp.json()["job"]["error_code"] == "E-REGEN-001"


def test_regenerate_section_requires_auth(client) -> None:
    resp = client.post("/internal/v1/regenerate-section", json={"brief": "x", "target_section_id": "hero-01", "page": {}})
    assert resp.status_code == 401 or resp.status_code == 403