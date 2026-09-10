"""Judge calibration (PART IX §9.4) — advisory.

Compares judge scores against a small human-labeled sample and reports mean
absolute error (MAE) and bias per criterion plus overall. Results are measured
and recorded; they are deliberately NOT an auto-block. While judge MAE stays
above the documented threshold, judge-only scores must not drive trend
decisions on their own.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from app.evaluation.judge import JudgeScore

CALIBRATION_DIR = Path(__file__).resolve().parents[2] / "evaluation" / "calibration"
HUMAN_LABELS_FILE = "human-labels.json"
MAX_ADVISORY_MAE = 0.5  # documented threshold: above this, judge is advisory-only


@dataclass
class CalibrationResult:
    n_cases: int
    judge_mode: str
    overall_mae: float
    overall_bias: float
    advisory_ok: bool
    per_criterion_mae: dict[str, float] = field(default_factory=dict)
    per_criterion_bias: dict[str, float] = field(default_factory=dict)
    rubric_ref: str = ""
    entries: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "rubric": self.rubric_ref,
            "n_cases": self.n_cases,
            "judge_mode": self.judge_mode,
            "overall_mae": round(self.overall_mae, 4),
            "overall_bias": round(self.overall_bias, 4),
            "per_criterion_mae": {k: round(v, 4) for k, v in sorted(self.per_criterion_mae.items())},
            "per_criterion_bias": {k: round(v, 4) for k, v in sorted(self.per_criterion_bias.items())},
            "advisory_ok": self.advisory_ok,
            "max_advisory_mae": MAX_ADVISORY_MAE,
            "entries": self.entries,
        }


def load_human_labels(path: Path | None = None) -> dict:
    p = path or (CALIBRATION_DIR / HUMAN_LABELS_FILE)
    return json.loads(p.read_text(encoding="utf-8"))


def calibrate(
    *,
    judge_scores: list[JudgeScore],
    rubric_ref: str,
    judge_mode: str,
    human_labels: dict,
    max_mae: float = MAX_ADVISORY_MAE,
) -> CalibrationResult:
    """Compare per-case judge scores (float(int)) against human labels.

    MAE = mean abs error; bias = mean (judge - human). A result is
    ``advisory_ok`` when overall MAE <= max_mae. When the judge is the stub
    surrogate, advisory_ok is forced False (not calibrated by construction).
    """
    sample = {e["case_id"]: e["labels"] for e in human_labels.get("sample", [])}
    comparable = [
        (sc, sample[sc.case_id])
        for sc in judge_scores
        if sc.case_id in sample and sc.scores
    ]
    entries: list[dict] = []
    criterion_totals: dict[str, list[float]] = {}
    all_deltas: list[float] = []
    for sc, labels in comparable:
        row = {"case_id": sc.case_id, "judge": dict(sc.scores), "human": labels}
        for crit, human in labels.items():
            j = sc.scores.get(crit)
            if j is None:
                continue
            delta = float(j) - float(human)
            all_deltas.append(delta)
            criterion_totals.setdefault(crit, []).append(delta)
        entries.append(row)

    per_mae = {
        crit: sum(abs(d) for d in deltas) / len(deltas)
        for crit, deltas in criterion_totals.items()
        if deltas
    }
    per_bias = {
        crit: sum(d for d in deltas) / len(deltas)
        for crit, deltas in criterion_totals.items()
        if deltas
    }
    overall_mae = sum(abs(d) for d in all_deltas) / len(all_deltas) if all_deltas else 1.0
    overall_bias = sum(all_deltas) / len(all_deltas) if all_deltas else 0.0
    advisory_ok = judge_mode == "llm" and len(all_deltas) > 0 and overall_mae <= max_mae

    return CalibrationResult(
        n_cases=len(comparable),
        judge_mode=judge_mode,
        overall_mae=overall_mae,
        overall_bias=overall_bias,
        advisory_ok=advisory_ok,
        per_criterion_mae=per_mae,
        per_criterion_bias=per_bias,
        rubric_ref=rubric_ref,
        entries=entries,
    )