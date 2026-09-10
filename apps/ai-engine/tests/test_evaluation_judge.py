"""Judge tests (PHASE 11): stub surrogate + LLM judge path + container fallback."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from app.api.container import build_container
from app.config import Settings
from app.contracts import Outcome, Usage
from app.evaluation.judge import (
    JudgeScore,
    LLMJudge,
    StubJudge,
    create_judge,
)
from app.evaluation.rubric import load_rubric
from app.providers.protocol import GenerationParams, ProviderResult

GOLDEN_DIR = Path(__file__).resolve().parents[1] / "evaluation" / "golden"


def _first_case() -> dict:
    return json.loads(min(GOLDEN_DIR.glob("*.json")).read_text(encoding="utf-8"))


def _build_container_without_key():
    return build_container(settings=Settings(openai_api_key=""))


def _run(coro):
    return asyncio.run(coro)


def test_create_judge_falls_back_to_stub_without_key() -> None:
    container = _build_container_without_key()
    judge = create_judge(container)
    assert isinstance(judge, StubJudge)
    assert judge.mode() == "stub"
    assert "not-calibrated" in judge.ref()


def test_stub_judge_scores_completed_page(container) -> None:
    rubric = load_rubric()
    judge = StubJudge(rubric=rubric)
    case = _first_case()

    async def go():
        job = await container.pipeline.run(brief=case["brief"], locale=case["locale"], job_id="j-stub")
        assert job.status == "COMPLETED"
        assert job.page
        return await judge.score(
            case_id=case["case_id"],
            brief=case["brief"],
            locale=case["locale"],
            page=job.page,
        )

    score = _run(go())
    assert isinstance(score, JudgeScore)
    assert score.case_id == case["case_id"]
    assert score.rubric_ref == "landing-page-quality@1.0.0"
    assert set(score.scores) == set(judge.rubric.criterion_ids())
    assert all(1 <= s <= 5 for s in score.scores.values())
    assert 1 <= score.overall <= 5
    assert score.usable is True
    assert score.calibrated is False
    assert score.error is None


def test_judge_failure_is_recorded_not_raised(container) -> None:
    rubric = load_rubric()
    judge = StubJudge(rubric=rubric)

    async def go():
        return await judge.score(
            case_id="x", brief="b", locale="en", page={"not": "a real page structure"}
        )

    score = _run(go())
    assert score.scores != {}
    assert score.error is None


class _FakeLLM:
    name = "fake-llm"

    def __init__(self) -> None:
        self.calls: list[dict] = []

    async def generate_structured(self, *, schema, prompt, inputs, params, feedback=None):
        self.calls.append({"schema": schema, "inputs": inputs, "params": params})
        return ProviderResult(
            outcome=Outcome.ok,
            data={
                "scores": {"structural": 5, "coherence": 4, "copy": 4, "cta": 5, "visual": 4, "accessibility": 4, "seo": 4},
                "reasons": {k: f"reason-{k}" for k in ("structural", "coherence", "copy", "cta", "visual", "accessibility", "seo")},
                "overall": 4,
                "usable": True,
                "summary": "clean page",
            },
            usage=Usage(0, 0),
        )


def test_llm_judge_path_uses_routing_schemas_prompt(container) -> None:
    container = build_container(settings=Settings(openai_api_key="sk-test"))
    model_def = container.routing.model("judge")
    assert model_def.provider == "openai"

    fake = _FakeLLM()
    container.providers.force_for_tests("judge", fake)
    judge = create_judge(container)
    assert isinstance(judge, LLMJudge)

    case = _first_case()

    async def go():
        job = await container.pipeline.run(brief=case["brief"], locale=case["locale"], job_id="j-llm")
        assert job.page
        return await judge.score(
            case_id=case["case_id"],
            brief=case["brief"],
            locale=case["locale"],
            page=job.page,
        )

    score = _run(go())
    assert score.mode == "llm"
    assert score.calibrated is True
    assert score.overall == 4
    assert score.usable is True
    assert score.judge_ref.startswith("judge-rubric@1.0.0::fake-llm::")
    assert fake.calls
    call = fake.calls[0]
    assert call["params"].temperature == 0.0
    assert "rubric_json" in call["inputs"]
    assert call["schema"]["required"] and "usable" in call["schema"]["required"]


def test_llm_judge_provider_error_records_failure(container) -> None:
    class _Broken:
        name = "broken"

        async def generate_structured(
            self,
            *,
            schema: dict,
            prompt: object,
            inputs: dict,
            params: GenerationParams,
            feedback: str | None = None,
        ) -> ProviderResult:
            return ProviderResult(
                outcome=Outcome.provider_error,
                message="timeout",
                usage=Usage(0, 0),
            )

    container = build_container(settings=Settings(openai_api_key="sk-test"))
    container.providers.force_for_tests("judge", _Broken())
    judge = create_judge(container)
    assert isinstance(judge, LLMJudge)

    async def go():
        return await judge.score(case_id="x", brief="b", locale="fr", page={"sections": []})

    score = _run(go())
    assert score.error is not None
    assert score.scores == {}