"""Repair ladder (PART VI §6.5): retry->honest-fail, and E-AI-005 hard errors."""

from __future__ import annotations

from app.api.container import build_container
from app.main import create_app
from app.providers.stub import StubProvider
from tests.helpers import FlakyProvider, QuotaThrottledProvider, RaisingProvider, RiggedProvider


def _generate(container, brief: str) -> dict:
    from fastapi.testclient import TestClient

    app = create_app(container=container)
    with TestClient(app) as client:
        resp = client.post(
            "/internal/v1/generate",
            headers={"X-Internal-Token": "dev-internal-token"},
            json={"brief": brief, "locale": "en"},
        )
        assert resp.status_code == 200
        return resp.json()["job"]


def test_flaky_stage_recovers_on_retry() -> None:
    container = build_container(provider_overrides={"fast": FlakyProvider(fail_first=1)})
    job = _generate(container, "Boutique hotel near the old town.")
    assert job["status"] == "COMPLETED"
    brief_stage = next(s for s in job["stages"] if s["stage"] == "brief-analyzer")
    assert brief_stage["attempts"] == 2
    assert brief_stage["repaired"] is False  # recovery came from the retry loop, not local repair
    retries = [a for a in job["ledger"]["attempts_detail"] if a["stage"] == "brief-analyzer"]
    assert [a["outcome"] for a in retries] == ["malformed", "ok"]


def test_rigged_stage_fails_honestly_e_ai_004() -> None:
    container = build_container(provider_overrides={"fast": RiggedProvider(), "premium": RiggedProvider()})
    job = _generate(container, "Boutique hotel near the old town.")
    assert job["status"] == "FAILED"
    assert job["error_code"] == "E-AI-004"
    first_missing = next((s for s in job["stages"] if not s["ok"]), None)
    assert first_missing is not None
    assert first_missing["fallback_used"] is True
    assert first_missing["draft"] is True
    assert first_missing["attempts"] == 2  # brief-analyzer max_attempts


def test_refused_quota_swaps_to_fallback_pool() -> None:
    container = build_container(
        provider_overrides={"fast": QuotaThrottledProvider(), "premium": StubProvider()}
    )
    job = _generate(container, "Boutique hotel near the old town.")
    assert job["status"] == "COMPLETED"
    brief_stage = next(s for s in job["stages"] if s["stage"] == "brief-analyzer")
    assert brief_stage["attempts"] == 2
    assert brief_stage["repaired"] is False
    detail = [a for a in job["ledger"]["attempts_detail"] if a["stage"] == "brief-analyzer"]
    assert [a["outcome"] for a in detail] == ["refused", "ok"]
    assert detail[1]["model_class"] == "premium"


def test_provider_crash_yields_e_ai_005_no_thrash() -> None:
    container = build_container(provider_overrides={"fast": RaisingProvider(), "premium": RaisingProvider()})
    job = _generate(container, "Boutique hotel near the old town.")
    assert job["status"] == "FAILED"
    assert job["error_code"] == "E-AI-005"
    assert "provider raised during brief-analyzer" in (job["error_message"] or "")
    detail = job["ledger"]["attempts_detail"]
    assert len(detail) == 1
    assert detail[0]["outcome"] == "provider_error"