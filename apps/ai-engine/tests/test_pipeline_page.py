"""Pipeline-level SchemaBuilder integration: page assembly, determinism, API."""

from __future__ import annotations

import asyncio

AR_BRIEF = "عيادة بيطرية تقدم رعاية للقطط والكلاب."


def test_completed_job_assembles_valid_page(container) -> None:
    job = asyncio.run(container.pipeline.run(brief=AR_BRIEF, locale="ar"))
    assert job.status == "COMPLETED"
    assert job.page is not None
    assert job.page_validation is not None and job.page_validation["valid"] is True
    assert job.build_issues == []
    assert len(job.page["sections"]) == 5
    assert job.page["page"]["direction"] == "rtl"


def test_schema_builder_is_not_a_provider_stage(container) -> None:
    job = asyncio.run(container.pipeline.run(brief="SaaS tool for team tasks.", locale="en"))
    assert [s.stage for s in job.stages] == [
        "brief-analyzer",
        "page-planner",
        "layout-planner",
        "content-generator",
        "asset-planner",
    ]


def test_page_assembly_is_deterministic(container) -> None:
    def run_with(job_id: str) -> dict:
        job = asyncio.run(container.pipeline.run(brief="SaaS tool for team tasks.", locale="en", job_id=job_id))
        return job.page or {}

    first = run_with("deterministic-probe-a")
    second = run_with("deterministic-probe-b")
    # generationId records the (varying) job id by design; everything else must match.
    assert first["metadata"].pop("generationId") == "deterministic-probe-a"
    assert second["metadata"].pop("generationId") == "deterministic-probe-b"
    assert first == second


def test_generate_endpoint_returns_page(client, auth_headers) -> None:
    resp = client.post("/internal/v1/generate", headers=auth_headers, json={"brief": AR_BRIEF, "locale": "ar"})
    assert resp.status_code == 200
    job = resp.json()["job"]
    assert job["page"] is not None
    assert job["page_validation"]["valid"] is True
    assert job["build_issues"] == []


def test_pages_endpoint_roundtrip(client, auth_headers) -> None:
    resp = client.post("/internal/v1/generate", headers=auth_headers, json={"brief": AR_BRIEF, "locale": "ar"})
    job_id = resp.json()["job"]["job_id"]
    page = client.get(f"/internal/v1/pages/{job_id}", headers=auth_headers)
    assert page.status_code == 200
    assert page.json()["page"] == resp.json()["job"]["page"]
    assert client.get("/internal/v1/pages/does-not-exist", headers=auth_headers).status_code == 404