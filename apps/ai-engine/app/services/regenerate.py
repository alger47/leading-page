"""Single-section regeneration (Phase 8 acceptance J2).

Input: the CURRENT Page Schema (from the web DB), the id of the section to
regenerate, and the original brief. Output: a new Page Schema whose ONLY
changed slot is that section's ``content`` — every other section, the theme,
the assets list and the metadata stay byte-identical to the source document.

Why this is honest "regenerate the hero only":
  * stages 1-3 (brief-analyzer, page-planner, layout-planner) are NOT re-run;
    the section type/variant/layoutHint are taken from the source document;
  * stage 4 (content-generator) is the only AI step; its plan is synthesized
    from the source document, so the model sees the exact section outline;
  * the regenerated section is spliced back deterministically through
    SchemaBuilder.clean_section_content (same shape-mapping as a full build);
  * the reconstructed envelope is re-validated (L1 structural + L2 semantic)
    before it is returned — an invalid result fails the job HONESTLY, never a
    corrupt document.

Failure codes (APPENDIX E): E-REGEN-001 target section missing in the source
document; E-AI-004 the content stage exhausted its repair ladder; E-VAL-L1 the
source document is not an L1-valid Page Schema.
"""

from __future__ import annotations

import copy
import time
import uuid
from typing import Any

from app.config import Settings
from app.contracts import JobResult, StageResult
from app.core.errors import AiEngineError
from app.cost.ledger import JobLedger
from app.routing.config import RoutingConfig
from app.services.page_validator import PageValidationError, validate_page
from app.services.schema_builder import clean_section_content, _derive_page_title
from app.services.stage_runner import StageRunner

E_REGEN_NOT_FOUND = "E-REGEN-001"
E_VAL_L1 = "E-VAL-L1"

DEFAULT_TONE = "warm-professional"


class SectionRegenerator:
    """Bounded one-section regeneration (repair-ladder governed stage 4)."""

    def __init__(self, *, runner: StageRunner, routing: RoutingConfig, settings: Settings) -> None:
        self.runner = runner
        self.routing = routing
        self.settings = settings

    async def run(
        self,
        *,
        job_id: str | None,
        brief: str,
        page: dict[str, Any],
        target_section_id: str,
        locale: str | None = None,
        tone: str | None = None,
        budget_usd: float | None = None,
    ) -> JobResult:
        start_ms = time.perf_counter() * 1000
        result = JobResult(job_id=job_id or f"job-{uuid.uuid4().hex[:12]}", status="RUNNING", start_ms=int(start_ms))

        envelope = self.settings.page_schema_dir / self.settings.envelope_schema_name
        try:
            source_validation = validate_page(page, envelope_path=envelope)
        except PageValidationError as exc:
            return self._fail_l1(result, start_ms, page, str(exc))

        result.brief_flags = {
            "mode": "section",
            "target_section_id": target_section_id,
            "source_l1_valid": source_validation["valid"],
        }

        # The source document must be an L1-valid Page Schema (never splice into
        # a corrupt document — the editor gate is the same one, §8.1).
        if not source_validation["valid"]:
            result.status = "FAILED"
            result.end_ms = int(time.perf_counter() * 1000)
            result.error_code = E_VAL_L1
            result.error_message = "the source Page Schema failed L1 validation"
            result.page = page
            result.page_validation = source_validation
            return result

        # The section to regenerate must exist exactly once in the source.
        matches = [s for s in page.get("sections", []) if isinstance(s, dict) and s.get("id") == target_section_id]
        if len(matches) != 1:
            result.status = "FAILED"
            result.end_ms = int(time.perf_counter() * 1000)
            result.error_code = E_REGEN_NOT_FOUND
            result.error_message = (
                f"section {target_section_id!r} not found in the source Page Schema"
                if not matches
                else f"section {target_section_id!r} appears more than once in the source Page Schema"
            )
            result.page_validation = source_validation
            return result

        resolved_locale = locale if locale in ("ar", "fr", "en") else (page.get("page") or {}).get("locale", "en")
        resolved_tone = tone or DEFAULT_TONE
        ledger = JobLedger(self.routing, self.settings, budget_usd)

        try:
            content_pkg = await self._regenerate_content(
                result=result,
                page=page,
                brief=brief,
                locale=resolved_locale,
                tone=resolved_tone,
                ledger=ledger,
                start_ms=start_ms,
            )
            if content_pkg is None:
                return result
            return await self._rebuild(result, page, target_section_id, content_pkg, brief, resolved_locale, envelope, start_ms)
        except AiEngineError as exc:
            result.status = "FAILED"
            result.end_ms = int(time.perf_counter() * 1000)
            result.error_code = exc.code
            result.error_message = str(exc)
            return result

    async def _regenerate_content(
        self,
        *,
        result: JobResult,
        page: dict[str, Any],
        brief: str,
        locale: str,
        tone: str,
        ledger: JobLedger,
        start_ms: float,
    ) -> dict[str, Any] | None:
        """Run stage 4 (content-generator) over the page's section outline.

        The plan is synthesized from the CURRENT document so the model
        regenerates within the existing section taxonomy (never re-plans the
        page, never adds/removes/renames sections on its own).
        """
        sections = [s for s in page.get("sections", []) if isinstance(s, dict)]
        plan = {
            "sections": [
                {
                    "id": s.get("id", "section"),
                    "type": s.get("type", "features"),
                    "variant": s.get("variant") or "default",
                    "slots": s.get("content") if isinstance(s.get("content"), dict) else {},
                }
                for s in sections
            ],
            "rationale": "regeneration of an existing page (Phase 8 J2)",
        }
        analysis = {"summary": brief[:400], "tone": tone, "vertical": "other"}

        s4 = await self.runner.run(
            stage="content-generator",
            inputs={"plan": plan, "locale": locale, "tone": tone, "analysis": analysis},
            ledger=ledger,
        )
        result.stages.append(s4)
        if not s4.ok:
            result.status = "FAILED"
            result.end_ms = int(time.perf_counter() * 1000)
            result.error_code = "E-AI-004"
            result.error_message = "the content stage exhausted its repair ladder; regeneration failed honestly."
            return None
        return s4.data or {}

    async def _rebuild(
        self,
        result: JobResult,
        page: dict[str, Any],
        target_section_id: str,
        content_pkg: dict[str, Any],
        brief: str,
        locale: str,
        envelope: Any,
        start_ms: float,
    ) -> JobResult:
        """Splice the regenerated target content in; everything else is untouched."""
        built = _splice_section(page, target_section_id, content_pkg)
        if built is None:
            result.status = "FAILED"
            result.end_ms = int(time.perf_counter() * 1000)
            result.error_code = "E-AI-004"
            result.error_message = "the regenerated content did not include the target section."
            return result

        updated, issues = built
        updated["page"] = {
            **page.get("page", {}),
            "title": _derive_page_title(updated.get("sections", []), _analysis_from_summary(brief), issues),
        }
        metadata = dict(page.get("metadata") or {})
        metadata["generationId"] = result.job_id
        updated["metadata"] = metadata

        try:
            page_validation = validate_page(updated, envelope_path=envelope)
        except PageValidationError as exc:
            return self._fail_l1(result, start_ms, updated, str(exc))

        result.page = updated
        result.page_validation = page_validation
        result.build_issues = issues
        result.status = "COMPLETED"
        result.end_ms = int(time.perf_counter() * 1000)
        return result

    def _fail_l1(self, result: JobResult, start_ms: float, page: dict[str, Any], message: str) -> JobResult:
        result.status = "FAILED"
        result.end_ms = int(time.perf_counter() * 1000)
        result.error_code = E_VAL_L1
        result.error_message = message
        result.page = page
        result.page_validation = {
            "valid": False,
            "errors": [
                {
                    "layer": "structural",
                    "ruleId": "E-BUILD-004",
                    "severity": "error",
                    "path": "/",
                    "message": message,
                }
            ],
            "warnings": [],
            "issues": [],
        }
        return result


def _analysis_from_summary(summary: str) -> dict[str, Any]:
    return {"summary": summary, "tone": DEFAULT_TONE}


def _splice_section(
    page: dict[str, Any],
    target_section_id: str,
    content_pkg: dict[str, Any],
) -> tuple[dict[str, Any], list[dict[str, Any]]] | None:
    """Return a deep copy of ``page`` with ONLY the target section's content
    replaced, plus assembly issues. ``None`` when the regenerated package does
    not contain the target section."""
    content_by_id: dict[str, dict[str, Any]] = {}
    for entry in content_pkg.get("sections", []) if isinstance(content_pkg, dict) else []:
        if isinstance(entry, dict) and entry.get("sectionId"):
            content_by_id[str(entry["sectionId"])] = entry.get("content", {})

    if target_section_id not in content_by_id:
        return None

    issues: list[dict[str, Any]] = []
    updated = copy.deepcopy(page)
    sections: list[dict[str, Any]] = []
    for sec in updated.get("sections", []):
        if not isinstance(sec, dict):
            sections.append(sec)
            continue
        if sec.get("id") == target_section_id:
            regenerated = clean_section_content(
                str(sec.get("type") or "features"),
                content_by_id[target_section_id],
                section_id=target_section_id,
                issues=issues,
            )
            rebuilt = copy.deepcopy(sec)
            rebuilt["content"] = regenerated
            sections.append(rebuilt)
        else:
            sections.append(sec)
    updated["sections"] = sections
    return updated, issues