"""End-to-end generation pipeline (PART VI).

Stages 1→2→3 run sequentially; stages 4 (ContentGenerator) and 5
(AssetPlanner) run in parallel (§6.10). SchemaBuilder/validators are
deterministic code, never free-typed by the LLM (stage 4 outputs per-section
slot content; the final Page Schema assembly is Phase 5's SchemaBuilder).

Honest failure: any stage that exhausts its repair ladder marks the job
FAILED with E-AI-004 and stops — no fake success (PD-05).
"""

from __future__ import annotations

import asyncio
import time
import uuid
from typing import Any

from app.config import Settings, inter_stage_delay
from app.contracts import JobResult, StageResult, generation_mode_for
from app.core.brief_validation import validate_brief
from app.core.errors import AiEngineError, ProviderHardError
from app.cost.ledger import JobLedger
from app.routing.config import RoutingConfig
from app.services.asset_renderer import AssetRenderer
from app.services.asset_store import JobAssetStore
from app.services.page_validator import PageValidationError, validate_page
from app.services.schema_builder import assemble
from app.services.stage_runner import StageRunner

ALL_STAGES = ("brief-analyzer", "page-planner", "layout-planner", "content-generator", "asset-planner", "asset-renderer")
PARALLEL_STAGES = ("content-generator", "asset-planner")


class Pipeline:
    # Pacing between LLM stages (only with real provider credentials): free-tier
    # vendor budgets (Groq ~7.5k tokens/min) refill continuously but bursty; a
    # short pause after each finished stage keeps the bucket from exhausting.
    inter_stage_delay_s: float = 30.0

    def __init__(
        self,
        *,
        runner: StageRunner,
        routing: RoutingConfig,
        settings: Settings,
        assets: JobAssetStore,
        images: AssetRenderer,
    ) -> None:
        self.runner = runner
        self.routing = routing
        self.settings = settings
        self.assets = assets
        self.images = images
        self._max_delay = max(0.0, inter_stage_delay(self.settings))

    async def _pace(self) -> None:
        if self._max_delay > 0:
            await asyncio.sleep(self._max_delay)

    async def run(
        self,
        *,
        brief: str,
        locale: str | None = None,
        tone: str | None = None,
        job_id: str | None = None,
        budget_usd: float | None = None,
        generate_images: bool = False,
        supplied_images: list[Any] | None = None,
    ) -> JobResult:
        start_ms = time.perf_counter() * 1000
        result = JobResult(job_id=job_id or f"job-{uuid.uuid4().hex[:12]}", status="RUNNING", start_ms=int(start_ms))

        # L0 gate (PART VIII §8.1): blocks the job before any LLM call.
        flags = validate_brief(brief, self.settings.max_brief_length)
        result.brief_flags = {
            "length": flags["length"],
            "locale_detected": flags["locale"],
            "injection_detected": flags["injection_detected"],
        }
        resolved_locale = locale if locale in ("ar", "fr", "en") else flags["locale"]
        ledger = JobLedger(self.routing, self.settings, budget_usd)

        try:
            return await self._run_stages(result, flags["brief"], resolved_locale, tone, ledger, start_ms, generate_images, supplied_images)
        except ProviderHardError as exc:
            if exc.attempt is not None:
                result.stages.append(
                    StageResult(
                        stage=exc.stage,
                        ok=False,
                        data=None,
                        attempts=[exc.attempt],
                        issues=exc.attempt.validation_issues,
                        error_code=exc.code,
                    )
                )
            return self._fail_with(result, start_ms, exc.code, str(exc))
        except AiEngineError as exc:
            return self._fail_with(result, start_ms, exc.code, str(exc))

    async def _run_stages(
        self,
        result: JobResult,
        brief_text: str,
        resolved_locale: str,
        tone: str | None,
        ledger: JobLedger,
        start_ms: float,
        generate_images: bool,
        supplied_images: list[Any] | None = None,
    ) -> JobResult:
        # Stage 1 — BriefAnalyzer
        s1 = await self.runner.run(
            stage="brief-analyzer",
            inputs={"brief": brief_text, "locale": resolved_locale},
            ledger=ledger,
        )
        result.stages.append(s1)
        if not s1.ok:
            return self._fail(result, start_ms, ledger)

        analysis = s1.data or {}
        resolved_tone = tone or (analysis.get("tone") if isinstance(analysis, dict) else None) or "warm-professional"

        # Stage 2 — PagePlanner
        await self._pace()
        s2 = await self.runner.run(
            stage="page-planner",
            inputs={"analysis": analysis},
            ledger=ledger,
        )
        result.stages.append(s2)
        if not s2.ok:
            return self._fail(result, start_ms, ledger)
        plan = s2.data or {}

        # Stage 3 — LayoutPlanner
        await self._pace()
        s3 = await self.runner.run(
            stage="layout-planner",
            inputs={"plan": plan, "analysis": analysis},
            ledger=ledger,
        )
        result.stages.append(s3)
        if not s3.ok:
            return self._fail(result, start_ms, ledger)

        # Stages 4 → 5 (serial) — parallel content+asset bursts exceed the Groq
        # free-tier RPM budget (429); run serially to stay under the bucket.
        await self._pace()
        s4 = await self.runner.run(
            stage="content-generator",
            inputs={"plan": plan, "locale": resolved_locale, "tone": resolved_tone, "analysis": analysis},
            ledger=ledger,
        )
        await self._pace()
        s5 = await self.runner.run(
            stage="asset-planner",
            inputs={"plan": plan},
            ledger=ledger,
        )
        result.stages.append(s4)
        result.stages.append(s5)
        if not (s4.ok and s5.ok):
            return self._fail(result, start_ms, ledger)

        # Stage 6 — AssetRenderer (image generation, opt-in). Off unless the
        # request asked for images AND AI_IMAGE_PROVIDER is enabled. Bounded
        # per-image failures never fail the job: the ref keeps the placeholder.
        # Product-link rasters (supplied_images) short-circuit the model call.
        if generate_images and self.images.enabled():
            await self._pace()
            s6, blobs = await self.images.render(
                requirements=(s5.data or {}).get("requirements") or [],
                tone=tone,
                ledger=ledger,
                supplied=supplied_images,
            )
            result.stages.append(s6)
            for blob in blobs:
                self.assets.put(result.job_id, blob["ref"], blob["mime"], bytes(blob["data"]))
            result.assets = list((s6.data or {}).get("images") or [])

        # Stage 7 — SchemaBuilder (deterministic code, never the LLM; §6.1).
        schema, build_issues = assemble(
            plan=plan,
            content=s4.data or {},
            layout=s3.data or {},
            analysis=analysis,
            job_id=result.job_id,
            locale=resolved_locale,
            prompt_versions=_prompt_versions(result.stages),
            model=_primary_model(result.stages),
        )
        envelope = self.settings.page_schema_dir / self.settings.envelope_schema_name
        try:
            page_validation = validate_page(schema, envelope_path=envelope)
        except PageValidationError as exc:  # canonical schema unavailable (misconfiguration)
            page_validation = {
                "valid": False,
                "errors": [
                    {
                        "layer": "structural",
                        "ruleId": "E-BUILD-004",
                        "severity": "error",
                        "path": "/",
                        "message": str(exc),
                    }
                ],
                "warnings": [],
                "issues": [],
            }
        result.page = schema
        result.page_validation = page_validation
        result.build_issues = build_issues
        result.brief_flags["generation_mode"] = generation_mode_for(result, self.routing)

        result.status = "COMPLETED"
        result.end_ms = int(time.perf_counter() * 1000)
        return result

    def _fail(self, result: JobResult, start_ms: float, ledger: JobLedger) -> JobResult:
        result.status = "FAILED"
        result.end_ms = int(time.perf_counter() * 1000)
        result.error_code = "E-AI-004"
        result.error_message = "A stage exhausted its repair ladder; generation failed honestly."
        return result

    def _fail_with(self, result: JobResult, start_ms: float, code: str, message: str) -> JobResult:
        result.status = "FAILED"
        result.end_ms = int(time.perf_counter() * 1000)
        result.error_code = code
        result.error_message = message
        return result


def _prompt_versions(stages: list[StageResult]) -> dict[str, str]:
    versions: dict[str, str] = {}
    for stage in stages:
        if not stage.attempts:
            continue
        prompt_ref = stage.attempts[0].prompt_ref
        versions[stage.stage] = prompt_ref.rsplit("@", 1)[-1] if "@" in prompt_ref else prompt_ref
    return versions


def _primary_model(stages: list[StageResult]) -> str:
    for stage in stages:
        if stage.stage == "content-generator" and stage.attempts:
            return stage.attempts[0].model_class
    for stage in stages:
        if stage.attempts:
            return stage.attempts[0].model_class
    return "stub"
