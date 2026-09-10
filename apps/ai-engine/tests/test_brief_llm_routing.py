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
    assert routing.route("brief-analyzer").fallbacks == ("brief-llm", "fast")
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