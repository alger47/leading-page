"""Regression harness tests (PHASE 11)."""

from __future__ import annotations

import asyncio
import json

from app.evaluation.regression import (
    THRESHOLDS,
    CaseOutcome,
    RegressionReport,
    compare_runs,
    percentile,
    render_markdown,
    render_metrics_live,
    run_regression,
)


def _run(coro):
    return asyncio.run(coro)


def test_percentile() -> None:
    assert percentile([], 0.5) == 0.0
    assert percentile([10.0], 0.9) == 10.0
    values = [float(i) for i in range(100)]
    assert percentile(values, 0.5) == 49.5
    assert percentile(values, 0.95) == 94.05


def test_run_regression_full_golden_subset(tmp_path) -> None:
    report = _run(run_regression(subset=5, report_dir=tmp_path, write_metrics=False))
    assert isinstance(report, RegressionReport)
    assert len(report.cases) == 5
    assert all(c.status == "COMPLETED" for c in report.cases)
    assert all(c.page_valid for c in report.cases)
    assert all(c.passed for c in report.cases)
    for key in THRESHOLDS:
        assert report.metrics.get(key) is not None
    assert report.gate_breaches == []
    assert report.judge_mode == "stub"
    assert report.failure_classes.get("page_schema") is None


def test_metrics_live_and_report_render(tmp_path) -> None:
    report = _run(run_regression(subset=3, report_dir=tmp_path, write_metrics=False))
    md = render_markdown(report)
    assert "Phase 11" in md
    assert "judge" in md.lower()
    live = render_metrics_live(report)
    assert "# Metrics Live" in live
    assert "schema_validity_rate" in live


def test_write_metrics_writes_files(tmp_path) -> None:
    report = _run(run_regression(subset=2, report_dir=tmp_path, write_metrics=True))
    runs = list(tmp_path.glob("phase11-regression-*.md"))
    assert len(runs) == 1
    assert (tmp_path / "metrics-live.md").exists()
    assert (tmp_path / "metrics-live.json").exists()
    roundtrip = json.loads((tmp_path / "metrics-live.json").read_text(encoding="utf-8"))
    assert roundtrip["judge_mode"] == "stub"
    assert report.gate_breaches == []


def test_compare_runs_reports_and_blocks() -> None:
    before = RegressionReport(
        rubric_ref="landing-page-quality@1.0.0",
        judge_mode="stub",
        judge_ref="stub",
        run_at="b",
        thresholds=dict(THRESHOLDS),
        cases=[
            CaseOutcome(
                case_id="saas-en-001", locale="en", status="COMPLETED", error_code=None,
                page_valid=True, page_errors=[], missing_required=[], missing_must=[],
                req_total=4, must_total=2, attempts=5, repaired=False, fallback_used=False,
                cost_usd=0.0, duration_ms=100, judged=True, usable=True, judge_overall=4,
            )
        ],
        metrics={k: 1.0 for k in THRESHOLDS},
        gate_breaches=[],
    )
    after = RegressionReport(
        rubric_ref="landing-page-quality@1.0.0",
        judge_mode="stub",
        judge_ref="stub",
        run_at="a",
        thresholds=dict(THRESHOLDS),
        cases=[
            CaseOutcome(
                case_id="saas-en-001", locale="en", status="COMPLETED", error_code=None,
                page_valid=True, page_errors=["page_schema"], missing_required=[], missing_must=[],
                req_total=4, must_total=2, attempts=5, repaired=False, fallback_used=False,
                cost_usd=0.0, duration_ms=100, judged=True, usable=False, judge_overall=2,
            )
        ],
        metrics={k: 0.9 for k in THRESHOLDS},
        gate_breaches=[],
    )
    after.failure_classes = {"page_schema": 1}
    md, block = compare_runs(before, after)
    assert "page_schema" in md
    assert block  # metrics dropped AND a new failure class appeared