"""Repair ladder (PART VI §6.5) — bounded, per stage:

generate → validate
  ├─ valid → continue
  └─ invalid → retry (≤ stage max, validation errors fed back)
        └─ still invalid → targeted re-ask (only the failing slots)
              └─ still invalid → local safe repair (deterministic fixes only)
                    └─ still invalid → stage fallback:
                          content stage  → deterministic default content (clearly marked draft)
                          planning stage → default page plan for the vertical
                    └─ job fails HONESTLY with E-AI-004 (never a fake success)

Provider hard errors (E-AI-005) are not retried in a thrash loop: they try the
configured fallback model class once, then fail honestly.
"""

from __future__ import annotations

import time
from typing import Any

from app.contracts import GenerationAttempt, Outcome, StageResult, Usage, ValidationIssue
from app.core.errors import ProviderHardError
from app.cost.ledger import JobLedger, estimate_cost_usd
from app.prompts.assets import PromptAsset
from app.prompts.registry import PromptStore
from app.providers.factory import ProviderRegistry
from app.providers.protocol import GenerationParams, StructuredLLMProvider
from app.routing.config import RoutingConfig, StageRoute
from app.services import fallbacks, repair
from app.services.validate import validate_stage_output

TARGETED_REASK_ATTEMPTS = 1


class StageRunner:
    def __init__(
        self,
        *,
        routing: RoutingConfig,
        providers: ProviderRegistry,
        prompts: PromptStore,
        schemas: Any,
    ) -> None:
        self.routing = routing
        self.providers = providers
        self.prompts = prompts
        self.schemas = schemas

    async def run(self, *, stage: str, inputs: dict[str, Any], ledger: JobLedger) -> StageResult:
        route = self.routing.route(stage)
        prompt = self.prompts.get(route.prompt)
        schema = self.schemas.load_by_stage(stage)
        primary_provider = self.providers.get(route.model_class)
        attempts: list[GenerationAttempt] = []
        last_data: dict[str, Any] | None = None
        last_issues: list[ValidationIssue] = []

        # 1. bounded generate→validate loop
        for attempt_no in range(1, route.max_attempts + 1):
            ledger.check_before_next()
            provider, model_class = _pick_provider(route, self.providers, primary_provider, attempts)
            feedback = _feedback_so_far(last_issues, attempts)
            attempt, res, data = await self._generate(
                stage=stage,
                prompt=prompt,
                schema=schema,
                inputs=inputs,
                route=route,
                model_class=model_class,
                provider=provider,
                ledger=ledger,
                attempt_no=attempt_no,
                feedback=feedback,
            )
            attempts.append(attempt)
            if res.outcome is Outcome.ok and data is not None:
                last_data = data
                last_issues, valid = validate_stage_output(stage, data, schema, inputs)
                attempt.validation_issues = last_issues
                if valid:
                    return _success(stage, data, attempts)
                continue
            last_data = None
            last_issues = [{"severity": "error", "message": res.message, "ruleId": "PROVIDER", "path": "$"}]

        # 2. targeted re-ask (only the failing slots)
        if last_data is not None and last_issues:
            for attempt_no in range(route.max_attempts + 1, route.max_attempts + 1 + TARGETED_REASK_ATTEMPTS):
                ledger.check_before_next()
                provider, model_class = _pick_provider(route, self.providers, primary_provider, attempts)
                targeted = _targeted_feedback(last_issues)
                attempt, res, data = await self._generate(
                    stage=stage,
                    prompt=prompt,
                    schema=schema,
                    inputs=inputs,
                    route=route,
                    model_class=model_class,
                    provider=provider,
                    ledger=ledger,
                    attempt_no=attempt_no,
                    feedback=targeted,
                )
                attempts.append(attempt)
                if res.outcome is Outcome.ok and data is not None:
                    last_data = data
                    last_issues, valid = validate_stage_output(stage, data, schema, inputs)
                    attempt.validation_issues = last_issues
                    if valid:
                        return _success(stage, data, attempts)

        # 3. local safe repair — deterministic fixes only
        if last_data is not None:
            fixed, applied = repair.apply_local_repair(stage, last_data, last_issues, schema)
            if applied:
                remaining, valid = validate_stage_output(stage, fixed, schema, inputs)
                if valid:
                    result = StageResult(stage=stage, ok=True, data=fixed, attempts=attempts, repaired=True)
                    result.issues = remaining
                    return result

        # 4. stage fallback → job fails honestly (E-AI-004)
        fallback_data = fallbacks.default_stage_data(stage, inputs)
        issues, _ = validate_stage_output(stage, fallback_data, schema, inputs)
        result = StageResult(
            stage=stage,
            ok=False,
            data=fallback_data,
            attempts=attempts,
            issues=issues,
            fallback_used=True,
            draft=True,
            error_code="E-AI-004",
        )
        return result

    async def _generate(
        self,
        *,
        stage: str,
        prompt: PromptAsset,
        schema: dict[str, Any],
        inputs: dict[str, Any],
        route: StageRoute,
        model_class: str,
        provider: StructuredLLMProvider,
        ledger: JobLedger,
        attempt_no: int,
        feedback: str | None,
    ) -> tuple[GenerationAttempt, Any, dict[str, Any] | None]:
        model_def = self.routing.model(model_class)
        params = GenerationParams(model=model_def.model_id, temperature=route.temperature)
        started = time.perf_counter()
        try:
            result = await provider.generate_structured(
                schema=schema,
                prompt=prompt,
                inputs=inputs,
                params=params,
                feedback=feedback,
            )
        except Exception as exc:  # noqa: BLE001 — provider plugin bug or network; honest, bounded
            latency = (time.perf_counter() - started) * 1000.0
            attempt = GenerationAttempt(
                stage=stage,
                attempt_number=attempt_no,
                prompt_ref=prompt.ref,
                model_class=model_class,
                provider=getattr(provider, "name", "?"),
                model_id=model_def.model_id,
                usage=Usage(0, 0),
                cost_usd=0.0,
                latency_ms=latency,
                outcome=Outcome.provider_error,
                validation_issues=[{"severity": "error", "ruleId": "PROVIDER", "path": "$", "message": str(exc)}],
            )
            ledger.record(attempt)
            raise ProviderHardError(
                f"provider raised during {stage} (E-AI-005): {exc}", stage=stage, attempt=attempt
            )
        latency = (time.perf_counter() - started) * 1000.0
        cost = estimate_cost_usd(model_class, result.usage.input_tokens, result.usage.output_tokens, self.routing)
        attempt = GenerationAttempt(
            stage=stage,
            attempt_number=attempt_no,
            prompt_ref=prompt.ref,
            model_class=model_class,
            provider=result.model or getattr(provider, "name", "?"),
            model_id=model_def.model_id,
            usage=result.usage,
            cost_usd=cost,
            latency_ms=latency,
            outcome=result.outcome,
            validation_issues=[],
        )
        ledger.record(attempt)
        return attempt, result, result.data


def _success(stage: str, data: dict[str, Any], attempts: list[GenerationAttempt]) -> StageResult:
    result = StageResult(stage=stage, ok=True, data=data, attempts=attempts)
    result.issues = []
    return result


def _pick_provider(
    route: StageRoute,
    registry: ProviderRegistry,
    primary: StructuredLLMProvider,
    attempts: list[GenerationAttempt],
) -> tuple[StructuredLLMProvider, str]:
    """Primary provider; after a provider error OR quota/auth refusal (HTTP
    429/401/403 → Outcome.refused), switch to the configured fallback model
    class — a different quota pool usually recovers without burning more
    attempts on the throttled one (thrash is forbidden, bounded by max_attempts)."""
    if attempts and attempts[-1].outcome in (Outcome.provider_error, Outcome.refused) and len(route.fallbacks) > 1:
        model_class = route.fallbacks[1] if route.fallbacks[1] != route.model_class else route.model_class
        return registry.get(model_class), model_class
    return primary, route.model_class


def _feedback_so_far(issues: list[dict], attempts: list[GenerationAttempt]) -> str | None:
    if issues:
        body = "; ".join(f"{i.get('path')}: {i.get('message')}" for i in issues[:5])
        return f"Validation failed. Fix these issues and return only the JSON: {body}"
    if attempts and attempts[-1].outcome is not Outcome.ok:
        return f"Previous attempt {attempts[-1].outcome.value}: {attempts[-1].validation_issues or 'no usable output'}"
    return None


def _targeted_feedback(issues: list[dict]) -> str:
    body = "; ".join(f"{i.get('path')}: {i.get('message')}" for i in issues[:8])
    return f"Targeted re-ask: fix ONLY these failing slots, keep everything else identical: {body}"