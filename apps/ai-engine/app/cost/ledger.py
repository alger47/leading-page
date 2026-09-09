"""Per-attempt cost ledger + job-level budget/attempt caps (PART VI §6.9).

Estimated cost = tokens/1000 * per-1k rate for the routed model class.
Phase 4 keeps the ledger in memory; persistence to GenerationAttempt rows
is Phase 6. Structure mirrors the entity in PART X §10.2.
"""

from __future__ import annotations

from app.config import Settings
from app.contracts import GenerationAttempt
from app.core.errors import JobAttemptsExceeded, JobBudgetExceeded
from app.routing.config import RoutingConfig


def estimate_cost_usd(model_class: str, input_tokens: int, output_tokens: int, routing: RoutingConfig) -> float:
    model = routing.model(model_class)
    return (input_tokens / 1000) * model.cost_per_1k_input + (output_tokens / 1000) * model.cost_per_1k_output


class JobLedger:
    """Budgets and attempt caps for a single job. Persistence comes in Phase 6."""

    def __init__(self, routing: RoutingConfig, settings: Settings, budget_usd: float | None = None) -> None:
        self.routing = routing
        self.settings = settings
        self.budget_usd = budget_usd if budget_usd is not None else settings.job_default_budget_usd
        self._attempts: list[GenerationAttempt] = []
        self._spent = 0.0

    @property
    def attempts(self) -> list[GenerationAttempt]:
        return list(self._attempts)

    @property
    def spent(self) -> float:
        return self._spent

    @property
    def attempt_count(self) -> int:
        return len(self._attempts)

    def check_before_next(self) -> None:
        if self.attempt_count >= self.routing.job_max_total_attempts:
            raise JobAttemptsExceeded("job attempt cap reached")

    def record(self, attempt: GenerationAttempt) -> None:
        self._attempts.append(attempt)
        self._spent += attempt.cost_usd
        if self._spent > self.budget_usd:
            raise JobBudgetExceeded(f"job cost budget (${self.budget_usd}) exceeded")