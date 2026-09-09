"""Generate endpoint: happy path, L0 gate, honest budget failure."""

from __future__ import annotations


def test_generate_completes(client, auth_headers, brief_sample) -> None:
    resp = client.post("/internal/v1/generate", headers=auth_headers, json={"brief": brief_sample, "locale": "en"})
    assert resp.status_code == 200
    job = resp.json()["job"]
    assert job["status"] == "COMPLETED"
    assert job["error_code"] is None
    assert len(job["stages"]) == 5
    assert all(s["ok"] for s in job["stages"])
    assert job["brief_flags"]["injection_detected"] is False
    assert job["ledger"]["attempts"] == 5
    assert job["ledger"]["cost_usd"] > 0
    for attempt in job["ledger"]["attempts_detail"]:
        assert attempt["outcome"] == "ok"
        assert attempt["cost_usd"] >= 0
        assert attempt["prompt"].startswith("stage")


def test_generate_empty_brief_blocks_l0(client, auth_headers) -> None:
    resp = client.post("/internal/v1/generate", headers=auth_headers, json={"brief": "   "})
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "E-AI-001"


def test_generate_overlong_brief_blocks_l0(client, auth_headers) -> None:
    resp = client.post("/internal/v1/generate", headers=auth_headers, json={"brief": "x" * 4001})
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "E-AI-001"


def test_generate_tiny_budget_fails_honestly(client, auth_headers, brief_sample) -> None:
    resp = client.post(
        "/internal/v1/generate",
        headers=auth_headers,
        json={"brief": brief_sample, "locale": "en", "budget_usd": 0.00001},
    )
    assert resp.status_code == 200
    job = resp.json()["job"]
    assert job["status"] == "FAILED"
    assert job["error_code"] == "E-AI-002"


def test_generate_locale_override_detects(client, auth_headers) -> None:
    ar_brief = "عيادة بيطرية تقدم رعاية للقطط والكلاب."
    resp = client.post(
        "/internal/v1/generate", headers=auth_headers, json={"brief": ar_brief, "locale": "ar"}
    )
    assert resp.status_code == 200
    assert resp.json()["job"]["brief_flags"]["locale_detected"] == "ar"


def test_ledger_endpoint_roundtrip(client, auth_headers, brief_sample) -> None:
    resp = client.post("/internal/v1/generate", headers=auth_headers, json={"brief": brief_sample})
    job_id = resp.json()["job"]["job_id"]
    ledger = client.get(f"/internal/v1/ledger/{job_id}", headers=auth_headers)
    assert ledger.status_code == 200
    assert ledger.json()["job_id"] == job_id
    assert client.get("/internal/v1/ledger/does-not-exist", headers=auth_headers).status_code == 404