"""Judge calibration tests (PHASE 11)."""

from __future__ import annotations

from app.evaluation.calibration import calibrate, load_human_labels
from app.evaluation.judge import JudgeScore


def _score(case_id: str, mapping: dict[str, int]) -> JudgeScore:
    return JudgeScore(
        case_id=case_id,
        rubric_ref="landing-page-quality@1.0.0",
        mode="llm",
        judge_ref="judge-rubric@1.0.0::fake::gpt",
        scores=mapping,
        reasons={},
        overall=3,
        usable=True,
        summary="",
    )


def test_calibrate_perfect_match() -> None:
    human = {
        "sample": [
            {
                "case_id": "a",
                "labels": {"structural": 4, "copy": 4},
            }
        ]
    }
    result = calibrate(
        judge_scores=[_score("a", {"structural": 4, "copy": 4})],
        rubric_ref="landing-page-quality@1.0.0",
        judge_mode="llm",
        human_labels=human,
    )
    assert result.overall_mae == 0.0
    assert result.overall_bias == 0.0
    assert result.n_cases == 1
    assert result.advisory_ok is True


def test_calibrate_mae_bias_sign() -> None:
    human = {
        "sample": [
            {
                "case_id": "a",
                "labels": {"structural": 3, "copy": 3},
            },
            {
                "case_id": "b",
                "labels": {"structural": 4, "copy": 4},
            },
        ]
    }
    scores = [
        _score("a", {"structural": 5, "copy": 4}),  # +2, +1
        _score("b", {"structural": 4, "copy": 5}),  #  0, +1
    ]
    result = calibrate(
        judge_scores=scores,
        rubric_ref="landing-page-quality@1.0.0",
        judge_mode="llm",
        human_labels=human,
    )
    assert result.overall_mae == 1.0
    assert result.overall_bias == 1.0
    assert result.per_criterion_mae["structural"] == 1.0
    assert result.advisory_ok is False  # MAE 1.0 exceeds the 0.5 advisory cap


def test_stub_judge_never_advisory_ok() -> None:
    human = {
        "sample": [
            {"case_id": "a", "labels": {"structural": 4}},
        ]
    }
    result = calibrate(
        judge_scores=[_score("a", {"structural": 4})],
        rubric_ref="landing-page-quality@1.0.0",
        judge_mode="stub",
        human_labels=human,
    )
    assert result.advisory_ok is False


def test_calibrate_skips_unlabeled_cases() -> None:
    human = {"sample": [{"case_id": "known", "labels": {"copy": 4}}]}
    result = calibrate(
        judge_scores=[
            _score("known", {"copy": 4}),
            _score("ghost", {"copy": 4}),
        ],
        rubric_ref="landing-page-quality@1.0.0",
        judge_mode="llm",
        human_labels=human,
    )
    assert result.n_cases == 1


def test_human_labels_asset_loads() -> None:
    data = load_human_labels()
    assert data["rubric"] == "landing-page-quality@1.0.0"
    assert len(data["sample"]) >= 1