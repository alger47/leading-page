"""Stage JSON Schema store.

Per ADR-0002 the canonical JSON Schema is the source of truth for every
stage's output contract. Providers are bound to these schemas (structured
output / tool-calling); output is always validated against them.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.core.errors import RoutingConfigError

SCHEMA_DIR = Path(__file__).resolve().parents[1] / "schemas"

# Mapping used by the stage runner: stage -> (output schema name).
STAGE_SCHEMAS: dict[str, str] = {
    "brief-analyzer": "brief_analyzer.output.json",
    "page-planner": "page_planner.output.json",
    "layout-planner": "layout_planner.output.json",
    "content-generator": "content_generator.output.json",
    "asset-planner": "asset_planner.output.json",
}


class SchemaStore:
    def __init__(self, directory: Path = SCHEMA_DIR) -> None:
        self.directory = directory
        self._cache: dict[str, dict[str, Any]] = {}

    def load(self, rel_path: str) -> dict[str, Any]:
        if rel_path not in self._cache:
            path = self.directory / rel_path
            if not path.exists():
                raise RoutingConfigError(f"schema not found: {rel_path}")
            self._cache[rel_path] = json.loads(path.read_text(encoding="utf-8"))
        return self._cache[rel_path]

    def load_by_stage(self, stage: str) -> dict[str, Any]:
        name = STAGE_SCHEMAS.get(stage)
        if name is None:
            raise RoutingConfigError(f"no output schema registered for stage {stage!r} (E-AI-006)")
        return self.load(name)

    def count(self) -> int:
        return len(STAGE_SCHEMAS)