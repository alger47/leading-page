"""Versioned rubric loader (PART IX §9.3).

The rubric is a production asset stored in evaluation/rubrics/rubric-v1.json
(single source of truth). It anchors 1–5 scales for the seven criteria:
structural correctness, semantic coherence, copy quality (locale-aware),
CTA strength, visual composition, accessibility, SEO completeness.
"""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel, field_validator

RUBRICS_DIR = Path(__file__).resolve().parents[2] / "evaluation" / "rubrics"
DEFAULT_RUBRIC = "rubric-v1.json"


class Criterion(BaseModel):
    id: str
    label: str
    min_score: int = 1
    max_score: int = 5
    anchors: dict[str, str]  # score "1".."5" -> anchor text


class Rubric(BaseModel):
    rubric: str
    version: str
    scale: str
    criteria: list[Criterion]

    @field_validator("version")
    @classmethod
    def _semver(cls, v: str) -> str:
        parts = v.split(".")
        if len(parts) != 3 or not all(p.isdigit() for p in parts):
            raise ValueError(f"rubric version must be semver-ish (x.y.z), got: {v!r}")
        return v

    @property
    def ref(self) -> str:
        return f"{self.rubric}@{self.version}"

    def criterion_ids(self) -> list[str]:
        return [c.id for c in self.criteria]


def load_rubric(path: Path | None = None) -> Rubric:
    p = path or (RUBRICS_DIR / DEFAULT_RUBRIC)
    return Rubric(**json.loads(p.read_text(encoding="utf-8")))