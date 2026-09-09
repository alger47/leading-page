"""Mini-eval (Phase 5 acceptance): ≥10 golden briefs through the full pipeline.

Measures (PART IX §9.2) with the stub provider: schema validity rate, per-stage
attempt counts and costs, repair occurrences, prompt-injection handling
(brief-as-data), and — since Phase 5 — assembled Page Schema validity (L1 +
SEM via the deterministic SchemaBuilder). Writes a Markdown report; exits
nonzero when validity drops below the configured target.

Run:  python -m app.evaluation.mini_eval
"""

from __future__ import annotations

import asyncio
import json
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from app.api.container import Container, build_container
from app.providers.protocol import StructuredLLMProvider

REPORTS_DIR = Path(__file__).resolve().parents[2] / "evaluation" / "reports"
GOLDEN_DIR = Path(__file__).resolve().parents[2] / "evaluation" / "golden"


@dataclass
class CaseOutcome:
    case_id: str
    locale: str
    status: str
    error_code: str | None
    total_attempts: int
    cost_usd: float
    injection_detected: bool = False
    forbidden_artifacts: list[str] = field(default_factory=list)
    page_valid: bool = False
    page_errors: list[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return self.status == "COMPLETED" and self.page_valid and not self.forbidden_artifacts


@dataclass
class MiniEvalReport:
    target_validity: float
    cases: list[CaseOutcome] = field(default_factory=list)
    per_stage: dict[str, dict] = field(default_factory=dict)
    validity_rate: float = 0.0
    first_attempt_ok_rate: float = 0.0
    total_attempts: int = 0
    total_cost_usd: float = 0.0
    pages_valid: int = 0

    def summary(self) -> dict:
        passed = sum(1 for c in self.cases if c.passed)
        page_validity = self.pages_valid / len(self.cases) if self.cases else 1.0
        return {
            "cases_run": len(self.cases),
            "cases_passed": passed,
            "validity_rate": round(self.validity_rate, 4),
            "target_validity": self.target_validity,
            "validity_met": self.validity_rate >= self.target_validity,
            "first_attempt_ok_rate": round(self.first_attempt_ok_rate, 4),
            "pages_valid": self.pages_valid,
            "pages_validity_rate": round(page_validity, 4),
            "total_attempts": self.total_attempts,
            "total_cost_usd": round(self.total_cost_usd, 6),
            "stages": self.per_stage,
            "injection_cases": [c.case_id for c in self.cases if c.injection_detected],
        }


FORBIDDEN_ARTIFACTS = ("EVIL HACKED", "<script", "alert(1)")


async def run_mini_eval(
    *,
    container: Container | None = None,
    provider_overrides: dict[str, StructuredLLMProvider] | None = None,
    golden_dir: Path = GOLDEN_DIR,
    report_dir: Path = REPORTS_DIR,
    target_validity: float | None = None,
    write_report: bool = True,
    report_name: str = "phase5-mini-eval.md",
) -> MiniEvalReport:
    container = container or build_container(provider_overrides=provider_overrides)
    target = target_validity if target_validity is not None else container.settings.eval_min_validity

    cases: list[dict] = []
    for path in sorted(golden_dir.glob("*.json")):
        cases.append(json.loads(path.read_text(encoding="utf-8")))

    outcomes: list[CaseOutcome] = []
    per_stage: dict[str, dict] = defaultdict(lambda: {"attempts": 0, "cost_usd": 0.0, "valid_attempts": 0})
    total_attempts = 0
    total_cost = 0.0
    first_ok = 0
    generation_attempts = 0
    pages_valid = 0

    for case in cases:
        job = await container.pipeline.run(brief=case["brief"], locale=case.get("locale"))
        dump = job.to_dict()
        forbidden = [a for a in FORBIDDEN_ARTIFACTS if a in json.dumps(dump, ensure_ascii=False)]
        pv = job.page_validation or {}
        outcome = CaseOutcome(
            case_id=case["case_id"],
            locale=case.get("locale", "?"),
            status=dump["status"],
            error_code=job.error_code,
            total_attempts=dump["ledger"]["attempts"],
            cost_usd=dump["ledger"]["cost_usd"],
            injection_detected=bool(dump["brief_flags"].get("injection_detected")),
            forbidden_artifacts=forbidden,
            page_valid=bool(dump.get("page") is not None and pv.get("valid")),
            page_errors=[i.get("ruleId", "?") for i in pv.get("errors", [])],
        )
        outcomes.append(outcome)
        if outcome.page_valid:
            pages_valid += 1
        total_attempts += outcome.total_attempts
        total_cost += outcome.cost_usd

        for attempt in dump["ledger"]["attempts_detail"]:
            generation_attempts += 1
            stage = attempt["stage"]
            per_stage[stage]["attempts"] += 1
            per_stage[stage]["cost_usd"] += attempt["cost_usd"]
            issues = attempt.get("issues") or []
            if attempt["outcome"] == "ok" and not any(i.get("severity") == "error" for i in issues):
                per_stage[stage]["valid_attempts"] += 1
                if attempt["attempt"] == 1:
                    first_ok += 1

    validity = (sum(s["valid_attempts"] for s in per_stage.values()) / generation_attempts) if generation_attempts else 1.0

    report = MiniEvalReport(
        target_validity=target,
        cases=outcomes,
        per_stage={k: dict(v) for k, v in sorted(per_stage.items())},
        validity_rate=validity,
        first_attempt_ok_rate=first_ok / generation_attempts if generation_attempts else 0.0,
        total_attempts=total_attempts,
        total_cost_usd=total_cost,
        pages_valid=pages_valid,
    )

    if write_report:
        report_dir.mkdir(parents=True, exist_ok=True)
        (report_dir / report_name).write_text(render_markdown(report), encoding="utf-8")
    return report


def render_markdown(report: MiniEvalReport) -> str:
    lines = [
        "# Phase 5 — Mini Eval Report",
        "",
        "- Generated: provider stub (deterministic)",
        f"- Target validity: {report.target_validity}",
        "",
        "## Summary",
        "",
        "| Metric | Value |",
        "| --- | --- |",
        f"| Cases run | {len(report.cases)} |",
        f"| Cases passed | {sum(1 for c in report.cases if c.passed)} |",
        f"| Schema validity rate | {report.validity_rate:.4f} |",
        f"| Validity meets target | {'yes' if report.validity_rate >= report.target_validity else 'NO'} |",
        f"| Assembled Page Schema valid | {report.pages_valid}/{len(report.cases)} |",
        f"| First-attempt OK rate | {report.first_attempt_ok_rate:.4f} |",
        f"| Total generation attempts | {report.total_attempts} |",
        f"| Total cost (USD) | {report.total_cost_usd:.6f} |",
        "",
        "## Per stage",
        "",
        "| Stage | Attempts | Valid | Cost (USD) |",
        "| --- | --- | --- | --- |",
    ]
    for stage, stats in report.per_stage.items():
        lines.append(
            f"| {stage} | {stats['attempts']} | {stats['valid_attempts']} | {stats['cost_usd']:.6f} |"
        )
    lines += ["", "## Cases", "", "| Case | Locale | Status | Attempts | Cost | Page | Injection | Artifacts |", "| --- | --- | --- | --- | --- | --- | --- | --- |"]
    for c in report.cases:
        lines.append(
            f"| {c.case_id} | {c.locale} | {c.status} | {c.total_attempts} | {c.cost_usd:.6f} | "
            f"{'valid' if c.page_valid else 'INVALID (' + ','.join(c.page_errors) + ')'} | "
            f"{c.injection_detected} | {','.join(c.forbidden_artifacts) or '-'} |"
        )
    return "\n".join(lines) + "\n"


async def _main() -> int:
    report = await run_mini_eval()
    print(render_markdown(report))
    summary = report.summary()
    print("META:", json.dumps(summary))
    if not summary["validity_met"] or summary["pages_validity_rate"] < summary["target_validity"]:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(_main()))