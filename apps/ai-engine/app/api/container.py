"""DI container — wires settings, routing, prompts, schemas, providers, runner,
pipeline and the in-memory job store once per process."""

from __future__ import annotations

import threading
from dataclasses import dataclass

from app.config import Settings, get_settings
from app.core.schema_store import SchemaStore
from app.prompts.registry import PromptStore
from app.providers.factory import ProviderRegistry
from app.providers.protocol import StructuredLLMProvider
from app.routing.config import RoutingConfig
from app.services.pipeline import Pipeline
from app.services.regenerate import SectionRegenerator
from app.services.stage_runner import StageRunner
from app.skills.registry import SkillsRegistry


class JobStore:
    """In-memory recent job results (Phase 4; persistence is Phase 6)."""

    def __init__(self, capacity: int = 500) -> None:
        self._jobs: dict[str, dict] = {}
        self._capacity = capacity
        self._lock = threading.Lock()

    def put(self, job_id: str, payload: dict) -> None:
        with self._lock:
            self._jobs[job_id] = payload
            while len(self._jobs) > self._capacity:
                oldest = next(iter(self._jobs))
                del self._jobs[oldest]

    def get(self, job_id: str) -> dict | None:
        with self._lock:
            return self._jobs.get(job_id)


@dataclass
class Container:
    settings: Settings
    routing: RoutingConfig
    schemas: SchemaStore
    prompts: PromptStore
    providers: ProviderRegistry
    runner: StageRunner
    pipeline: Pipeline
    regenerator: SectionRegenerator
    skills: SkillsRegistry
    jobs: JobStore


def build_container(
    settings: Settings | None = None,
    provider_overrides: dict[str, StructuredLLMProvider] | None = None,
) -> Container:
    settings = settings or get_settings()
    routing = RoutingConfig.from_path(settings.routing_config_path)
    if settings.brief_analyzer_llm and settings.openai_api_key:
        # Phase 13: LLM-aware brief analysis (opt-in via AI_BRIEF_ANALYZER_LLM).
        # `brief-llm` is pinned to openai in routing.yaml — only enable it when
        # the matching credential exists, otherwise the factory would raise on
        # the first brief-analyzer call. Anthropic-only setups point
        # routing.yaml's `brief-llm.provider` at "anthropic" instead.
        routing.enable_brief_analyzer_llm("brief-llm")
    schemas = SchemaStore()
    prompts = PromptStore(schemas=schemas)
    providers = ProviderRegistry(settings, routing)
    if provider_overrides:
        for model_class, provider in provider_overrides.items():
            providers.force_for_tests(model_class, provider)
    runner = StageRunner(routing=routing, providers=providers, prompts=prompts, schemas=schemas)
    pipeline = Pipeline(runner=runner, routing=routing, settings=settings)
    regenerator = SectionRegenerator(runner=runner, routing=routing, settings=settings)
    skills = SkillsRegistry(prompts=prompts)
    return Container(
        settings=settings,
        routing=routing,
        schemas=schemas,
        prompts=prompts,
        providers=providers,
        runner=runner,
        pipeline=pipeline,
        regenerator=regenerator,
        skills=skills,
        jobs=JobStore(),
    )