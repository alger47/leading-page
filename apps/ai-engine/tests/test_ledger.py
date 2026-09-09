"""Cost ledger and job bounds."""

from __future__ import annotations

import pytest

from app.config import Settings
from app.contracts import GenerationAttempt, Outcome, Usage
from app.core.errors import JobAttemptsExceeded, JobBudgetExceeded
from app.cost.ledger import JobLedger, estimate_cost_usd
from app.routing.config import RoutingConfig


@pytest.fixture(scope="module")
def routing() -> RoutingConfig:
    return RoutingConfig.from_path(Settings().routing_config_path)


def _attempt(price: float = 0.01) -> GenerationAttempt:
    return GenerationAttempt(
        stage="brief-analyzer",
        attempt_number=1,
        prompt_ref="stage1-brief-analyzer@1.0.0",
        model_class="fast",
        provider="stub",
        model_id="stub-fast",
        usage=Usage(input_tokens=100, output_tokens=100),
        cost_usd=price,
        latency_ms=1.0,
        outcome=Outcome.ok,
        validation_issues=[],
    )


def test_estimate_cost_usd_matches_rates(routing) -> None:
    cost = estimate_cost_usd("fast", 1000, 1000, routing)
    assert cost == pytest.approx(0.0001 + 0.0004, abs=1e-9)


def test_job_budget_exceeded(routing, settings) -> None:
    ledger = JobLedger(routing, settings, budget_usd=0.015)
    ledger.record(_attempt(0.01))
    with pytest.raises(JobBudgetExceeded):
        ledger.record(_attempt(0.01))


def test_job_attempt_cap(routing, settings) -> None:
    settings = settings.model_copy(deep=True) if hasattr(settings, "model_copy") else settings
    ledger = JobLedger(routing, settings, budget_usd=10.0)
    for _ in range(18):
        ledger.record(_attempt(0.0))
    with pytest.raises(JobAttemptsExceeded):
        ledger.check_before_next()