"""Skills taxonomy: capability labels mapping to existing stages + prompts (GAP-5)."""

from __future__ import annotations

import pytest

from app.core.errors import RoutingConfigError
from app.skills.registry import CANONICAL_STAGES, SkillsRegistry


def test_taxonomy_is_fully_resolved(container) -> None:
    skills = container.skills.all()
    assert len(skills) >= 5
    ids = [skill.id for skill in skills]
    assert len(ids) == len(set(ids)), "skill ids must be unique"
    for skill in skills:
        assert skill.name
        assert len(skill.stages) >= 1
        assert len(skill.prompts) >= 1


def test_every_routing_stage_is_covered_by_production_skill(container) -> None:
    production = container.skills.get("landing-page-production")
    assert production is not None
    assert set(production.stages) == set(container.routing.stages)
    assert set(production.stages) == CANONICAL_STAGES


def test_all_registered_prompts_are_referenced(container) -> None:
    refs = {name.split("@", 1)[0] for name in container.prompts.refs()}
    referenced = {p for skill in container.skills.all() for p in skill.prompts}
    assert referenced == refs


def test_stage_index_roundtrip(container) -> None:
    analysis = container.skills.for_stage("brief-analyzer")
    ids = {skill.id for skill in analysis}
    assert {"brief-analysis", "localization", "brand-tone"} <= ids


def test_registry_validates_unknown_stage(container, tmp_path) -> None:
    taxonomy = tmp_path / "taxonomy.yaml"
    taxonomy.write_text(
        """
skills:
  - id: bogus
    name: Bogus
    stages: [does-not-exist]
    prompts: []
""".strip(),
        encoding="utf-8",
    )
    with pytest.raises(RoutingConfigError):
        SkillsRegistry(prompts=container.prompts, taxonomy_path=taxonomy)


def test_registry_validates_unknown_prompt(container, tmp_path) -> None:
    taxonomy = tmp_path / "taxonomy.yaml"
    taxonomy.write_text(
        """
skills:
  - id: bogus
    name: Bogus
    stages: [brief-analyzer]
    prompts: [no-such-prompt]
""".strip(),
        encoding="utf-8",
    )
    with pytest.raises(RoutingConfigError):
        SkillsRegistry(prompts=container.prompts, taxonomy_path=taxonomy)


def test_skills_endpoint_lists_taxonomy(client, auth_headers) -> None:
    resp = client.get("/internal/v1/skills", headers=auth_headers)
    assert resp.status_code == 200
    skills = resp.json()["skills"]
    assert "landing-page-production" in {skill["id"] for skill in skills}
    assert any(skill["id"] == "copywriting" for skill in skills)


def test_skills_endpoint_requires_internal_token(client) -> None:
    assert client.get("/internal/v1/skills").status_code == 401
    assert client.get("/internal/v1/skills", headers={"X-Internal-Token": "wrong"}).status_code == 401
    assert client.get("/internal/v1/skills", headers={"X-Internal-Token": "dev-internal-token"}).status_code == 200


def test_skills_endpoint_payload_shape(client, auth_headers) -> None:
    resp = client.get("/internal/v1/skills", headers=auth_headers)
    skill = next(s for s in resp.json()["skills"] if s["id"] == "landing-page-production")
    assert skill["name"] == "Landing page production"
    assert len(skill["stages"]) >= 5
    assert len(skill["prompts"]) >= 5