"""Drift guard for the committed renderer fixtures (ai-*.json in page-schema examples).

The stub is deterministic; the exported Page Schemas must stay byte-identical to
fresh pipeline runs or renderer snapshots silently diverge (§6.12).
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from app.evaluation.export_fixtures import FIXTURES, run
from app.services.page_validator import validate_page

EXAMPLES = Path(__file__).resolve().parents[3] / "packages" / "page-schema" / "examples"


def test_committed_fixtures_match_fresh_engine_output() -> None:
    exit_code = asyncio.run(run(check=True))
    assert exit_code == 0


def test_fixtures_pass_canonical_l1_and_l2(settings) -> None:
    envelope = settings.page_schema_dir / settings.envelope_schema_name
    for name, _, _ in FIXTURES:
        schema = json.loads((EXAMPLES / f"{name}.json").read_text(encoding="utf-8"))
        validation = validate_page(schema, envelope_path=envelope)
        assert validation["valid"] is True, f"{name}: {validation['errors']}"


def test_fixture_files_exist() -> None:
    for name, _, _ in FIXTURES:
        assert (EXAMPLES / f"{name}.json").exists()