"""Nightly evaluation run (PHASE 11).

Runs the full golden regression and re-judges the human-labeled calibration
sample, writes metrics-live + calibration-live, and fails loudly (exit != 0)
when a threshold is breached. Designed to be scheduled (cron, Task Scheduler,
or GitHub Actions):

    python -m app.evaluation.nightly
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from app.api.container import Container, build_container
from app.evaluation.calibration import calibrate, load_human_labels
from app.evaluation.judge import Judge, JudgeScore, create_judge
from app.evaluation.regression import REPORTS_DIR, render_metrics_live, run_regression
from app.evaluation.rubric import Rubric, load_rubric


async def _judge_calibration_sample(
    container: Container,
    judge: Judge,
    rubric: Rubric,
    golden_dir: Path,
    human: dict,
) -> list[JudgeScore]:
    scores: list[JudgeScore] = []
    for entry in human.get("sample", []):
        case_id = entry["case_id"]
        path = golden_dir / f"{case_id}.json"
        if not path.exists():
            continue
        case = json.loads(path.read_text(encoding="utf-8"))
        job = await container.pipeline.run(brief=case["brief"], locale=case.get("locale", "en"), job_id=f"cal-{case_id}")
        if job.status != "COMPLETED" or not job.page:
            continue
        scores.append(
            await judge.score(
                case_id=case_id,
                brief=case["brief"],
                locale=case.get("locale", "en"),
                page=job.page,
            )
        )
    return scores


async def _main(args: argparse.Namespace) -> int:
    container = build_container()
    rubric = load_rubric()
    judge = create_judge(container, rubric)

    report = await run_regression(
        container=container,
        judge=judge,
        golden_dir=Path(args.golden_dir),
        report_dir=Path(args.reports_dir),
        write_metrics=True,
    )

    human = load_human_labels()
    sample_scores = await _judge_calibration_sample(container, judge, rubric, Path(args.golden_dir), human)
    cal = calibrate(
        judge_scores=sample_scores,
        rubric_ref=rubric.ref,
        judge_mode=judge.mode(),
        human_labels=human,
    )
    cal_file = Path(args.reports_dir) / "calibration-live.json"
    cal_file.write_text(json.dumps(cal.to_dict(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    ok = not report.gate_breaches
    print(render_metrics_live(report))
    print("CALIBRATION:", json.dumps(cal.to_dict()))
    if not ok:
        print("NIGHTLY FAIL:", "; ".join(report.gate_breaches))
    return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--golden-dir", default=str(Path(__file__).resolve().parents[2] / "evaluation" / "golden"))
    parser.add_argument("--reports-dir", default=str(REPORTS_DIR))
    args = parser.parse_args()
    return asyncio.run(_main(args))


if __name__ == "__main__":
    sys.exit(main())