"""Domain errors and E-AI error codes.

Codes follow the master prompt's honest-failure policy:
- E-AI-001  L0 brief validation failed (blocks job start)
- E-AI-002  per-job cost budget exceeded
- E-AI-003  per-job attempt budget exceeded
- E-AI-004  stage fallback used / job failed honestly (never a fake success)
- E-AI-005  provider hard error (no thrashy retries)
- E-AI-006  unknown stage / invalid routing configuration
"""

from __future__ import annotations

from typing import Any


class AiEngineError(Exception):
    code = "E-AI-000"


class BriefValidationError(AiEngineError):
    code = "E-AI-001"


class JobBudgetExceeded(AiEngineError):
    code = "E-AI-002"


class JobAttemptsExceeded(AiEngineError):
    code = "E-AI-003"


class StageFailedHonestly(AiEngineError):
    code = "E-AI-004"


class ProviderHardError(AiEngineError):
    """Provider plugin crash / network failure. Carries the failed attempt so it
    is still reported in the job ledger before the job stops (E-AI-005)."""

    code = "E-AI-005"

    def __init__(self, message: str = "", *, stage: str = "", attempt: Any | None = None) -> None:
        super().__init__(message)
        self.stage = stage
        self.attempt = attempt


class RoutingConfigError(AiEngineError):
    code = "E-AI-006"