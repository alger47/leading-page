"""Phase 13: LLM-aware brief analysis routing + brief-analysis transparency.

- `route("brief-analyzer")` may be pointed at an LLM model class while every
  other stage keeps its routing (opt-in via build_container when credentials
  exist). Default stays the deterministic keyword analyzer.
- The generate response surfaces the small brief-analysis payload (vertical /
  tone / has_enough_facts) on the brief-analyzer stage so the worker can relay
  it into job events.
"""

from __future__ import annotations

from pathlib import Path

from app.api.container import build_container
from app.config import Settings
from app.contracts import (
    GenerationAttempt,
    JobResult,
    Outcome,
    StageResult,
    Usage,
    generation_mode_for,
)
from app.routing.config import RoutingConfig

ROUTING_PATH = Path("config/routing.yaml")


def test_default_routing_keeps_stub_brief_analyzer() -> None:
    routing = RoutingConfig.from_path(ROUTING_PATH)
    assert routing.route("brief-analyzer").model_class == "fast"
    assert routing.route("page-planner").model_class == "fast"


def test_enable_brief_analyzer_llm_affects_only_that_stage() -> None:
    routing = RoutingConfig.from_path(ROUTING_PATH)
    routing.enable_brief_analyzer_llm("brief-llm")
    assert routing.route("brief-analyzer").model_class == "brief-llm"
    assert routing.route("brief-analyzer").fallbacks == ("brief-llm", "fast", "premium")
    # untouched stages keep their routing
    assert routing.route("content-generator").model_class == "premium"
    assert routing.route("page-planner").model_class == "fast"


def test_container_enables_llm_brief_analyzer_only_when_opted_in() -> None:
    assert build_container().routing.route("brief-analyzer").model_class == "fast"
    # a key alone is not enough — the feature must be opted into explicitly
    assert build_container(settings=Settings(openai_api_key="sk-test")).routing.route("brief-analyzer").model_class == "fast"
    opted = build_container(settings=Settings(openai_api_key="sk-test", brief_analyzer_llm=True))
    assert opted.routing.route("brief-analyzer").model_class == "brief-llm"
    assert opted.routing.route("content-generator").model_class == "premium"


def test_generate_surfaces_brief_analysis_payload(client, auth_headers, brief_sample) -> None:
    resp = client.post("/internal/v1/generate", headers=auth_headers, json={"brief": brief_sample, "locale": "en"})
    assert resp.status_code == 200
    job = resp.json()["job"]
    brief_stage = next(s for s in job["stages"] if s["stage"] == "brief-analyzer")
    assert brief_stage["ok"] is True
    assert brief_stage["data"] is not None
    assert brief_stage["data"]["has_enough_facts"] is False
    assert isinstance(brief_stage["data"]["vertical"], str)
    # other stages keep their payload internal
    gen_stage = next(s for s in job["stages"] if s["stage"] == "content-generator")
    assert "data" not in gen_stage
    # the completed job also carries the honest demo-mode flag (stub here)
    assert job["brief_flags"]["generation_mode"] == "stub"


def _attempt(model_class: str, outcome: Outcome = Outcome.ok) -> GenerationAttempt:
    return GenerationAttempt(
        stage="content-generator",
        attempt_number=1,
        prompt_ref="stage4-content-generator@stable",
        model_class=model_class,
        provider=model_class,
        model_id=model_class,
        usage=Usage(1, 1),
        cost_usd=0.0,
        latency_ms=1.0,
        outcome=outcome,
    )


def _job_with_content_attempt(model_class: str, outcome: Outcome = Outcome.ok) -> JobResult:
    job = JobResult(job_id="j", status="COMPLETED")
    job.stages.append(StageResult(stage="content-generator", ok=True, attempts=[_attempt(model_class, outcome)]))
    return job


class _FakeModel:
    def __init__(self, provider: str) -> None:
        self.provider = provider


class _FakeRouting:
    def __init__(self, provider_by_class: dict[str, str]) -> None:
        self._providers = provider_by_class

    def model(self, model_class: str) -> _FakeModel:
        return _FakeModel(self._providers[model_class])


def test_generation_mode_resolves_through_routing() -> None:
    job = _job_with_content_attempt("premium")
    stub_routing = _FakeRouting({"premium": "stub", "fast": "stub"})
    llm_routing = _FakeRouting({"premium": "openai", "fast": "stub"})
    assert generation_mode_for(job, stub_routing) == "stub"
    assert generation_mode_for(job, llm_routing) == "llm"


def test_generation_mode_ignores_failed_llm_attempts() -> None:
    job = _job_with_content_attempt("premium", outcome=Outcome.refused)
    assert generation_mode_for(job, _FakeRouting({"premium": "openai", "fast": "stub"})) == "stub"


def test_regenerate_section_path_carries_generation_mode(container) -> None:
    import asyncio

    async def scenario() -> None:
        source = await container.pipeline.run(brief="SaaS tool for team tasks.", locale="en", job_id="mode-regen-src")
        assert source.status == "COMPLETED" and source.page is not None
        hero_id = next(s["id"] for s in source.page["sections"] if s["type"] == "hero")
        job = await container.regenerator.run(
            job_id="mode-regen",
            brief="better copy",
            page=source.page,
            target_section_id=hero_id,
            locale="en",
        )
        assert job.status == "COMPLETED", job.error_message
        assert job.to_dict()["brief_flags"]["generation_mode"] == "stub"

    asyncio.run(scenario())