"""healthz + internal-auth boundary."""

from __future__ import annotations

REQUIRED_CHECKS = {"schemas", "prompts", "stages"}


def test_healthz_public(client) -> None:
    resp = client.get("/healthz")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["service"] == "ai-engine"
    assert REQUIRED_CHECKS.issubset(body["checks"])
    assert body["checks"]["schemas"] == 5
    assert body["checks"]["prompts"] == 6  # 5 stage prompts + judge-rubric


def test_internal_endpoint_requires_token(client) -> None:
    assert client.get("/internal/v1/prompts").status_code == 401
    assert client.get("/internal/v1/prompts", headers={"X-Internal-Token": "wrong"}).status_code == 401
    assert client.get("/internal/v1/prompts", headers={"X-Internal-Token": "dev-internal-token"}).status_code == 200


def test_generate_requires_token(client) -> None:
    assert client.post("/internal/v1/generate", json={"brief": "hello"}).status_code == 401