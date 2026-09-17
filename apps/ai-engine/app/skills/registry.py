"""Skills taxonomy (PART VI: the recommendation's `skills/` layer).

Skills are a READ-only index over the existing engine primitives: each skill
maps to the engine stages + versioned prompt assets that fulfil it. They never
replace the stage pipeline and never introduce new agents; a skill is just a
stable capability label for UIs, routing decisions and future marketplace
surfaces. The taxonomy is data (taxonomy.yaml); code never hardcodes a skill.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml

from app.core.errors import RoutingConfigError
from app.prompts.registry import PromptStore

DEFAULT_TAXONOMY = Path(__file__).resolve().parent / "taxonomy.yaml"

# Canonical stage vocabulary of the engine (config/routing.yaml `stages:`).
# Skills reference these labels; the coverage test in tests/test_skills.py
# asserts the shipped routing matches this set exactly.
CANONICAL_STAGES: frozenset[str] = frozenset(
    {
        "brief-analyzer",
        "page-planner",
        "layout-planner",
        "content-generator",
        "asset-planner",
    }
)


@dataclass(frozen=True)
class Skill:
    id: str
    name: str
    description: str
    stages: tuple[str, ...]
    prompts: tuple[str, ...]


class SkillsRegistry:
    def __init__(
        self,
        prompts: PromptStore,
        taxonomy_path: Path = DEFAULT_TAXONOMY,
    ) -> None:
        self._skills: dict[str, Skill] = {}
        self._by_stage: dict[str, list[str]] = {}
        self._load(taxonomy_path, prompts)

    def _load(self, path: Path, prompts: PromptStore) -> None:
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        for item in raw.get("skills") or []:
            skill_id = str(item["id"])
            if skill_id in self._skills:
                raise RoutingConfigError(f"duplicate skill id: {skill_id}")
            stages = tuple(str(s) for s in item.get("stages") or [])
            prompts_names = tuple(str(p) for p in item.get("prompts") or [])
            for stage in stages:
                if stage not in CANONICAL_STAGES:
                    raise RoutingConfigError(
                        f"skill {skill_id!r} references non-canonical stage {stage!r}"
                    )
            for prompt in prompts_names:
                if not prompts.has(prompt):
                    raise RoutingConfigError(f"skill {skill_id!r} references unknown prompt {prompt!r}")
            skill = Skill(
                id=skill_id,
                name=str(item["name"]),
                description=str(item.get("description", "")),
                stages=stages,
                prompts=prompts_names,
            )
            self._skills[skill_id] = skill
            for stage in stages:
                self._by_stage.setdefault(stage, []).append(skill_id)

    def all(self) -> list[Skill]:
        return list(self._skills.values())

    def get(self, skill_id: str) -> Skill | None:
        return self._skills.get(skill_id)

    def for_stage(self, stage: str) -> list[Skill]:
        return [self._skills[sid] for sid in self._by_stage.get(stage, [])]

    def ids(self) -> list[str]:
        return list(self._skills.keys())