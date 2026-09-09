"""Export deterministic AI-generated Page Schema fixtures (Phase 5).

Runs the stub pipeline on the fixture briefs and writes the assembled Page
Schema JSON into packages/page-schema/examples/, where the ui-components
renderer snapshots pin schema → DOM (§6.12). The stub is deterministic, so the
committed files must stay byte-identical to fresh runs — ``--check`` verifies
that in CI (drift guard).

Run:
  py -m app.evaluation.export_fixtures            # write the two fixtures
  py -m app.evaluation.export_fixtures --check    # verify no drift
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from app.api.container import build_container

REPO_ROOT = Path(__file__).resolve().parents[4]
EXAMPLES_DIR = Path(__file__).resolve().parents[4] / "packages" / "page-schema" / "examples"

FIXTURES: tuple[tuple[str, str, str], ...] = (
    ("ai-vet-ar-001", "عيادة بيطرية تقدم رعاية للقطط والكلاب.", "ar"),
    ("ai-saas-en-001", "SaaS tool for managing your team's tasks.", "en"),
)


def _encode(schema: dict) -> str:
    return json.dumps(schema, ensure_ascii=False, indent=2) + "\n"


async def export_one(*, container, name: str, brief: str, locale: str) -> tuple[dict, bool, list[str]]:
    job = await container.pipeline.run(brief=brief, locale=locale, job_id=f"fixture-{name}")
    pv = job.page_validation or {}
    valid = job.status == "COMPLETED" and job.page is not None and bool(pv.get("valid"))
    errors = [i.get("ruleId", "?") for i in pv.get("errors", [])]
    return (job.page or {}), valid, errors


async def run(*, check: bool = False, examples_dir: Path = EXAMPLES_DIR) -> int:
    container = build_container()
    examples_dir.mkdir(parents=True, exist_ok=True)
    failed = False
    for name, brief, locale in FIXTURES:
        schema, valid, errors = await export_one(container=container, name=name, brief=brief, locale=locale)
        if not valid:
            print(f"SKIP {name}: assembled page invalid ({', '.join(errors) or 'status=FAILED'})")
            failed = True
            continue
        target = examples_dir / f"{name}.json"
        expected = _encode(schema)
        if check:
            if target.exists():
                ok = target.read_text(encoding="utf-8") == expected
                print(f"{'OK ' if ok else 'DRIFT'} {name}")
                failed = failed or not ok
            else:
                print(f"MISSING {name}")
                failed = True
        else:
            target.write_text(expected, encoding="utf-8")
            print(f"WROTE {target.relative_to(REPO_ROOT)}")
    return 1 if failed else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="verify committed fixtures match fresh output")
    args = parser.parse_args()
    return asyncio.run(run(check=args.check))


if __name__ == "__main__":
    sys.exit(main())