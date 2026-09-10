"""Evaluation & regression harness (PART IX §9.2 / §9.5).

Runs the full golden dataset through the pipeline, scores every assembled page
with the advisory judge, and produces:

- a dated per-run report (Markdown + JSON);
- a refreshed ``metrics-live`` table (the "metrics table live" of PHASE 11);
- a before/after comparison report with the §9.5 gate via ``--compare``.

Metrics follow the Part IX §9.2 formulas:

  schema_validity_rate   valid assembled pages / generation attempts
  render_success_rate    completed pages with an assembled schema / attempts
  first_try_usable_rate  pages rated usable without any repair / total
  content_completeness   satisfied expect criteria / total expect criteria
  visual_quality_score   judge rubric mean (advisory)
  repair_rate            attempts needing >1 try / attempts
  cost_per_successful_page  total spend / usable pages
  latency                p50/p95 per stage and end-to-end

The judge is advisory (LLM-as-judge when a key exists; deterministic stub
surrogate otherwise — every report states the judge mode).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.api.container import Container, build_container
from app.evaluation.judge import Judge, create_judge
from app.evaluation.rubric import load_rubric

REPORTS_DIR = Path(__file__).resolve().parents[2] / "evaluation" / "reports"
GOLDEN_DIR = Path(__file__).resolve().parents[2] / "evaluation" / "golden"

# §9.2 documented targets, enforced by this harness (see evaluation/thresholds.md).
THRESHOLDS = {
    "schema_validity_rate": 0.99,
    "render_success_rate": 0.99,
    "first_try_usable_rate": 0.90,
    "content_completeness": 0.90,
}


@dataclass
class CaseOutcome:
    case_id: str
    locale: str
    status: str
    error_code: str | None
    page_valid: bool
    page_errors: list[str]
    missing_required: list[str]
    missing_must: list[str]
    req_total: int
    must_total: int
    attempts: int
    repaired: bool
    fallback_used: bool
    cost_usd: float
    duration_ms: int
    judged: bool
    usable: bool
    judge_overall: int

    @property
    def passed(self) -> bool:
        return self.status == "COMPLETED" and self.page_valid and not (self.missing_required or self.missing_must)


@dataclass
class RegressionReport:
    rubric_ref: str
    judge_mode: str
    judge_ref: str
    run_at: str
    thresholds: dict[str, float]
    cases: list[CaseOutcome] = field(default_factory=list)
    per_stage: dict[str, dict] = field(default_factory=dict)
    metrics: dict[str, float] = field(default_factory=dict)
    gate_breaches: list[str] = field(default_factory=list)
    failure_classes: dict[str, int] = field(default_factory=dict)

    def summary(self) -> dict[str, Any]:
        return {
            "run_at": self.run_at,
            "rubric": self.rubric_ref,
            "judge_mode": self.judge_mode,
            "judge": self.judge_ref,
            "metrics": self.metrics,
            "thresholds": self.thresholds,
            "gate_breaches": self.gate_breaches,
        }

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_at": self.run_at,
            "rubric": self.rubric_ref,
            "judge_mode": self.judge_mode,
            "judge_ref": self.judge_ref,
            "thresholds": self.thresholds,
            "cases": [vars(c) for c in self.cases],
            "per_stage": self.per_stage,
            "metrics": self.metrics,
            "gate_breaches": self.gate_breaches,
            "failure_classes": self.failure_classes,
        }


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    k = (len(ordered) - 1) * pct
    f = int(k)
    c = min(f + 1, len(ordered) - 1)
    return ordered[f] + (ordered[c] - ordered[f]) * (k - f)


def _compute_metrics(report: RegressionReport) -> None:
    cases = report.cases
    n = len(cases) or 1
    valid = sum(1 for c in cases if c.page_valid)
    rendered = sum(1 for c in cases if c.status == "COMPLETED" and c.page_valid)

    total_criteria = sum(c.req_total + c.must_total for c in cases) or 1
    satisfied_criteria = total_criteria - sum(len(c.missing_required) + len(c.missing_must) for c in cases)
    completeness = satisfied_criteria / total_criteria

    first_ok_usable = sum(
        1 for c in cases if c.judged and c.usable and not c.repaired and not c.fallback_used
    )
    repair_rate = sum(1 for c in cases if c.repaired) / n

    judged = [c for c in cases if c.judged]
    visual_score = sum(c.judge_overall for c in judged) / len(judged) if judged else 0.0
    cost_total = sum(c.cost_usd for c in cases)
    usable_count = sum(1 for c in cases if c.judged and c.usable)
    cost_per_ok = cost_total / usable_count if usable_count else 0.0

    e2e = [float(c.duration_ms) for c in cases]
    metrics = {
        "schema_validity_rate": round(valid / n, 6),
        "render_success_rate": round(rendered / n, 6),
        "first_try_usable_rate": round(first_ok_usable / n, 6),
        "content_completeness": round(completeness, 6),
        "visual_quality_score": round(visual_score, 3),
        "repair_rate": round(repair_rate, 4),
        "cost_per_successful_page": round(cost_per_ok, 6),
        "cost_total_usd": round(cost_total, 6),
        "e2e_latency_ms_p50": round(percentile(e2e, 0.50), 1),
        "e2e_latency_ms_p95": round(percentile(e2e, 0.95), 1),
    }
    for stage, stats in report.per_stage.items():
        lat = stats.get("latency_ms", [])
        metrics[f"latency_ms_p50:{stage}"] = round(percentile(lat, 0.50), 1)
        metrics[f"latency_ms_p95:{stage}"] = round(percentile(lat, 0.95), 1)
    report.metrics = metrics
    report.gate_breaches = [
        f"{key}: {metrics.get(key, 1.0):.4f} < {report.thresholds[key]:.4f}"
        for key in ("schema_validity_rate", "render_success_rate", "first_try_usable_rate", "content_completeness")
        if metrics.get(key, 1.0) < report.thresholds[key]
    ]


def _iter_cases(golden_dir: Path):
    for path in sorted(golden_dir.glob("*.json")):
        yield json.loads(path.read_text(encoding="utf-8"))


async def run_regression(
    *,
    container: Container | None = None,
    judge: Judge | None = None,
    golden_dir: Path = GOLDEN_DIR,
    report_dir: Path = REPORTS_DIR,
    subset: int | None = None,
    write_metrics: bool = True,
) -> RegressionReport:
    container = container or build_container()
    rubric = load_rubric()
    judge = judge or create_judge(container, rubric)

    cases = list(_iter_cases(golden_dir))
    if subset is not None:
        cases = cases[:subset]

    outcomes: list[CaseOutcome] = []
    per_stage: dict[str, dict] = defaultdict(lambda: {"attempts": 0, "cost_usd": 0.0, "repairs": 0, "latency_ms": []})
    failures_by_class: dict[str, int] = defaultdict(int)

    for case in cases:
        job = await container.pipeline.run(brief=case["brief"], locale=case.get("locale", "en"), job_id=f"reg-{case['case_id']}")
        dump = job.to_dict()
        page = dump.get("page") or {}
        flat = json.dumps(dump, ensure_ascii=False)
        pv = job.page_validation or {}
        exp = case.get("expect", {})
        types = [s.get("type") for s in page.get("sections", [])]
        missing_required = [r for r in exp.get("required_sections", []) if r not in types]
        missing_must = [m for m in exp.get("content_must_include", []) if (m or "") not in flat]
        stage_out = dump.get("stages") or []
        detail = dump.get("ledger", {}).get("attempts_detail") or []
        for s in stage_out:
            stats = per_stage[s["stage"]]
            stats["attempts"] += s["attempts"]
            stats["cost_usd"] += s["cost_usd"]
            stats["repairs"] += int(bool(s.get("repaired")))
            stats["latency_ms"].extend(
                float(a["latency_ms"]) for a in detail if a.get("stage") == s["stage"]
            )
        repaired = any(a.get("attempt", 1) > 1 for a in detail) or any(s.get("repaired") for s in stage_out)
        fallback = any(s.get("fallback_used") for s in stage_out)
        ledger = dump.get("ledger", {})
        for issue in (pv.get("errors") or []):
            failures_by_class[issue.get("ruleId", "?")] += 1

        score = (
            await judge.score(
                case_id=case["case_id"],
                brief=case["brief"],
                locale=case.get("locale", "en"),
                page=page,
            )
            if page and job.status == "COMPLETED"
            else None
        )

        outcomes.append(
            CaseOutcome(
                case_id=case["case_id"],
                locale=case.get("locale", "en"),
                status=dump["status"],
                error_code=job.error_code,
                page_valid=bool(pv.get("valid")) and job.status == "COMPLETED",
                page_errors=[i.get("ruleId", "?") for i in pv.get("errors", [])],
                missing_required=missing_required,
                missing_must=missing_must,
                req_total=len(exp.get("required_sections", [])),
                must_total=len(exp.get("content_must_include", [])),
                attempts=ledger.get("attempts", 0),
                repaired=repaired,
                fallback_used=fallback,
                cost_usd=ledger.get("cost_usd", 0.0),
                duration_ms=ledger.get("duration_ms", 0),
                judged=score is not None,
                usable=bool(score and score.usable),
                judge_overall=int(score.overall) if score else 0,
            )
        )

    report = RegressionReport(
        rubric_ref=rubric.ref,
        judge_mode=judge.mode(),
        judge_ref=judge.ref(),
        run_at=datetime.now(UTC).isoformat(timespec="seconds"),
        thresholds=dict(THRESHOLDS),
        cases=outcomes,
        per_stage={k: dict(v) for k, v in sorted(per_stage.items())},
    )
    _compute_metrics(report)
    report.failure_classes = dict(sorted(failures_by_class.items()))

    if write_metrics:
        report_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        run_md = report_dir / f"phase11-regression-{stamp}.md"
        run_json = report_dir / f"phase11-regression-{stamp}.json"
        run_md.write_text(render_markdown(report), encoding="utf-8")
        run_json.write_text(json.dumps(report.to_dict(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (report_dir / "metrics-live.md").write_text(render_metrics_live(report), encoding="utf-8")
        (report_dir / "metrics-live.json").write_text(
            json.dumps(report.summary(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    return report


def render_markdown(report: RegressionReport) -> str:
    lines = [
        "# Phase 11 - Regression Report",
        "",
        f"- Run: {report.run_at}",
        f"- Rubric: {report.rubric_ref}",
        f"- Judge: {report.judge_mode} ({report.judge_ref}) - advisory",
        f"- Cases: {len(report.cases)}",
        "",
        "## Metrics (PART IX section 9.2)",
        "",
        "| Metric | Value | Target |",
        "| --- | --- | --- |",
    ]
    order = [
        "schema_validity_rate", "render_success_rate", "first_try_usable_rate",
        "content_completeness", "visual_quality_score", "repair_rate",
        "cost_per_successful_page", "cost_total_usd", "e2e_latency_ms_p50", "e2e_latency_ms_p95",
    ]
    for key in order:
        target = report.thresholds.get(key)
        target_str = f"{target:.4f}" if target is not None else "-"
        lines.append(f"| {key} | {report.metrics.get(key, 0.0):.4f} | {target_str} |")
    lines += [
        "",
        "## Per stage latency",
        "",
        "| Stage | Attempts | Repairs | Cost (USD) | p50 (ms) | p95 (ms) |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for stage, stats in report.per_stage.items():
        lines.append(
            f"| {stage} | {stats['attempts']} | {stats['repairs']} | {stats['cost_usd']:.6f} | "
            f"{percentile(stats['latency_ms'], 0.50):.1f} | {percentile(stats['latency_ms'], 0.95):.1f} |"
        )
    lines += [
        "",
        "## Failure classes",
        "",
        ", ".join(f"{k} x{v}" for k, v in sorted(report.failure_classes.items())) or "none",
        "",
        "## Gate",
        "",
        f"- Breaches: {', '.join(report.gate_breaches) if report.gate_breaches else 'none'}",
        "",
        "## Cases",
        "",
        "| Case | Locale | Status | Valid | Repaired | Attempts | Cost | Judge ok | Usable | Missing req | Missing must |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for c in report.cases:
        lines.append(
            f"| {c.case_id} | {c.locale} | {c.status} | {c.page_valid} | {c.repaired} | {c.attempts} | "
            f"{c.cost_usd:.6f} | {c.judged} | {c.usable} | {','.join(c.missing_required) or '-'} | {','.join(c.missing_must) or '-'} |"
        )
    return "\n".join(lines) + "\n"


def render_metrics_live(report: RegressionReport) -> str:
    lines = [
        "# Metrics Live - golden regression (PART IX section 9.2)",
        "",
        f"Updated: {report.run_at}",
        f"Judge: {report.judge_mode} ({report.judge_ref}) - advisory",
        "",
        "| Metric | Value | Target |",
        "| --- | --- | --- |",
    ]
    for key, target in report.thresholds.items():
        lines.append(f"| {key} | {report.metrics.get(key, 1.0):.4f} | {target:.4f} |")
    lines.append(f"| visual_quality_score | {report.metrics.get('visual_quality_score', 0.0):.4f} | - |")
    return "\n".join(lines) + "\n"


def compare_runs(before: RegressionReport, after: RegressionReport) -> tuple[str, list[str]]:
    """section 9.5 before/after comparison. Returns (markdown, block-reasons)."""
    block: list[str] = []
    rows = ["# Regression comparison (before -> after)", "", "| Metric | Before | After | Delta |", "| --- | --- | --- | --- |"]
    for key, target in before.thresholds.items():
        b = before.metrics.get(key, 0.0)
        a = after.metrics.get(key, 0.0)
        delta = a - b
        rows.append(f"| {key} | {b:.4f} | {a:.4f} | {delta:+.4f} |")
        if delta < 0:
            block.append(f"{key} dropped {delta:+.4f} below target {target:.4f}")

    b_classes = set(before.failure_classes)
    a_classes = set(after.failure_classes)
    new_classes = sorted(a_classes - b_classes)
    if new_classes:
        block.append(f"new failure classes: {', '.join(new_classes)}")

    rows += ["", "## New failure classes", ""]
    rows.append(", ".join(new_classes) or "none")
    rows += ["", "## Changed cases", "", "| Case | Before | After |", "| --- | --- | --- |"]
    b_map = {c.case_id: c for c in before.cases}
    for c in after.cases:
        pb = b_map.get(c.case_id)
        if pb is None or pb.usable != c.usable or pb.page_valid != c.page_valid or c.passed != pb.passed:
            rows.append(
                f"| {c.case_id} | {pb.status if pb else '-'}/valid={bool(pb and pb.page_valid)}/usable={bool(pb and pb.usable)} | "
                f"{c.status}/valid={c.page_valid}/usable={c.usable} |"
            )
    return "\n".join(rows) + "\n", block


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def _load_report(path: Path) -> RegressionReport:
    data = json.loads(path.read_text(encoding="utf-8"))
    report = RegressionReport(
        rubric_ref=data["rubric"],
        judge_mode=data["judge_mode"],
        judge_ref=data["judge_ref"],
        run_at=data["run_at"],
        thresholds=data["thresholds"],
        cases=[CaseOutcome(**c) for c in data["cases"]],
        per_stage=data.get("per_stage", {}),
        metrics=data.get("metrics", {}),
        gate_breaches=data.get("gate_breaches", []),
    )
    report.failure_classes = data.get("failure_classes", {})
    return report


async def _run_main(args: argparse.Namespace) -> int:
    golden = Path(args.golden_dir)
    report_dir = Path(args.reports_dir)
    report = await run_regression(golden_dir=golden, report_dir=report_dir, subset=args.subset)
    print(render_markdown(report))
    print("META:", json.dumps(report.summary()))
    return 1 if report.gate_breaches else 0


def _compare_main(args: argparse.Namespace) -> int:
    before = _load_report(Path(args.before))
    after = _load_report(Path(args.after))
    md, block = compare_runs(before, after)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(md, encoding="utf-8")
    print(md)
    if block:
        print("BLOCKED:", "; ".join(block))
        return 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd")
    run = sub.add_parser("run", help="run the golden regression")
    run.add_argument("--golden-dir", default=str(GOLDEN_DIR))
    run.add_argument("--reports-dir", default=str(REPORTS_DIR))
    run.add_argument("--subset", type=int, default=None, help="run only the first N cases (CI fast check)")
    cmp = sub.add_parser("compare", help="section 9.5 before/after comparison")
    cmp.add_argument("before")
    cmp.add_argument("after")
    cmp.add_argument("--out", default=str(REPORTS_DIR / "comparison-report.md"))
    args = parser.parse_args()

    if args.cmd == "compare":
        return _compare_main(args)
    return asyncio.run(_run_main(args))


if __name__ == "__main__":
    sys.exit(main())