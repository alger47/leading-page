"""Mini-eval: full-pipeline acceptance run on the golden briefs."""

from __future__ import annotations

import json

from app.api.container import build_container
from app.evaluation.mini_eval import GOLDEN_DIR, run_mini_eval


def test_golden_briefs_all_complete(container) -> None:
    report = None

    async def go():
        return await run_mini_eval(container=container, write_report=False)

    import asyncio

    report = asyncio.run(go())

    assert len(report.cases) >= 36
    assert all(c.status == "COMPLETED" for c in report.cases)
    assert all(c.passed for c in report.cases)
    assert all(c.page_valid for c in report.cases)
    assert report.validity_rate >= report.target_validity
    assert report.summary()["pages_validity_rate"] >= report.target_validity


def test_golden_set_has_injection_case() -> None:
    cases = [json.loads(p.read_text(encoding="utf-8")) for p in GOLDEN_DIR.glob("*.json")]
    injection = [c for c in cases if c["case_id"] == "injection-en-006"]
    assert len(injection) == 1
    assert any(k in injection[0]["brief"].lower() for k in ("ignore", "instructions"))


def test_mini_eval_writes_report(tmp_path) -> None:
    container = build_container()

    async def go():
        return await run_mini_eval(container=container, report_dir=tmp_path)

    import asyncio

    report = asyncio.run(go())
    report_file = tmp_path / "phase5-mini-eval.md"
    assert report_file.exists()
    text = report_file.read_text(encoding="utf-8")
    assert "# Phase 5" in text
    assert "injection-en-006" in text
    assert report.summary()["validity_met"] is True
    assert report.summary()["pages_validity_rate"] == 1.0