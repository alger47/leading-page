"""Routing configuration loader (PART VI §6.3).

Model routing is configuration, not code: stage -> model_class + fallbacks;
model_class -> provider + cost rates + default model id. A model change is a
config change + an evaluation run — never a code edit.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from app.core.errors import RoutingConfigError

DEFAULT_ROUTING = Path(__file__).resolve().parents[2] / "config" / "routing.yaml"


@dataclass(frozen=True)
class ModelDef:
    provider: str
    model_id: str
    cost_per_1k_input: float
    cost_per_1k_output: float


@dataclass(frozen=True)
class StageRoute:
    prompt: str  # prompt asset name
    model_class: str
    temperature: float
    max_attempts: int
    fallbacks: tuple[str, ...] = ("fast",)
    max_output_tokens: int = 2048


@dataclass
class RoutingConfig:
    models: dict[str, ModelDef]
    stages: dict[str, StageRoute]
    job_max_total_attempts: int
    job_default_budget_usd: float
    # When enabled, the brief-analyzer alone is routed through an LLM model
    # class (keyword matching is a weak detector). Default off: the classic
    # deterministic analyzer runs until credentials exist and the operator
    # opts in via enable_brief_analyzer_llm().
    _brief_analyzer_llm_model_class: str | None = None

    @classmethod
    def from_path(cls, path: Path = DEFAULT_ROUTING) -> RoutingConfig:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
        return cls.from_dict(raw or {})

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> RoutingConfig:
        models: dict[str, ModelDef] = {}
        for name, m in (raw.get("models") or {}).items():
            models[name] = ModelDef(
                provider=m["provider"],
                model_id=m.get("model_id", name),
                cost_per_1k_input=float(m.get("cost_per_1k_input", 0.0)),
                cost_per_1k_output=float(m.get("cost_per_1k_output", 0.0)),
            )
        stages: dict[str, StageRoute] = {}
        for name, s in (raw.get("stages") or {}).items():
            model_class = s["model_class"]
            if model_class not in models:
                raise RoutingConfigError(f"stage {name!r} references unknown model class {model_class!r}")
            fallbacks = tuple(str(f) for f in s.get("fallbacks", [model_class]))
            for f in fallbacks:
                if f not in models:
                    raise RoutingConfigError(f"stage {name!r} fallback references unknown model class {f!r}")
            stages[name] = StageRoute(
                prompt=s["prompt"],
                model_class=model_class,
                temperature=float(s.get("temperature", 0.0)),
                max_attempts=int(s.get("max_attempts", 2)),
                fallbacks=fallbacks,
                max_output_tokens=int(s.get("max_output_tokens", 2048)),
            )
        job = raw.get("job") or {}
        return cls(
            models=models,
            stages=stages,
            job_max_total_attempts=int(job.get("max_total_attempts", 18)),
            job_default_budget_usd=float(job.get("default_budget_usd", 0.25)),
        )

    def route(self, stage: str) -> StageRoute:
        route = self.stages.get(stage)
        if route is None:
            raise RoutingConfigError(f"no route for stage {stage!r} (E-AI-006)")
        if (
            stage == "brief-analyzer"
            and self._brief_analyzer_llm_model_class is not None
            and self._brief_analyzer_llm_model_class in self.models
        ):
            llm = self._brief_analyzer_llm_model_class
            return StageRoute(
                prompt=route.prompt,
                model_class=llm,
                temperature=route.temperature,
                max_attempts=route.max_attempts,
                fallbacks=(llm, *tuple(f for f in route.fallbacks if f != llm)),
            )
        return route

    def enable_brief_analyzer_llm(self, model_class: str) -> None:
        """Route ONLY the brief-analyzer through `model_class` (an LLM) while
        the rest of the pipeline stays on its configured routing. No-op (and
        stored) even if the model class is unknown; `route()` re-checks.
        Safe default stays the deterministic analyzer when unset."""
        self._brief_analyzer_llm_model_class = model_class

    def model(self, model_class: str) -> ModelDef:
        model = self.models.get(model_class)
        if model is None:
            raise RoutingConfigError(f"no model definition for {model_class!r} (E-AI-006)")
        return model