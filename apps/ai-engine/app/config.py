"""Application settings for the AI Engine service."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="AI_", env_file=".env", extra="ignore")

    env: str = "development"
    service_name: str = "ai-engine"
    version: str = "0.1.0"

    # Internal auth (Worker -> AI Engine). Never a real secret in production.
    internal_token: str = "dev-internal-token"

    # Default provider for model classes not pinned in routing config.
    provider: str = "stub"  # stub | openai | anthropic

    # Config-driven model routing (PART VI §6.3): changing a model is a config change.
    routing_config_path: Path = ROOT / "config" / "routing.yaml"

    # L0 brief validation caps (PART VIII §8.1).
    max_brief_length: int = 4000

    # Job-level bounds (PART VI §6.5/§6.9).
    job_max_total_attempts: int = 18
    job_default_budget_usd: float = 0.25

    # Mini-eval acceptance target (PART IX §9.2).
    eval_min_validity: float = 0.99

    # Canonical Page Schema contracts (ADR-0002 single source of truth).
    # Defaults to packages/page-schema/schema in the monorepo; overridable via
    # AI_PAGE_SCHEMA_DIR when the engine is deployed without the monorepo.
    page_schema_dir: Path = ROOT.parents[1] / "packages" / "page-schema" / "schema"
    envelope_schema_name: str = "envelope.schema.json"

    # HTTP provider credentials (empty => provider unavailable, tests use stub).
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    anthropic_api_key: str = ""
    anthropic_base_url: str = "https://api.anthropic.com"

    # Phase 13: route ONLY the brief-analyzer through an LLM (LLM-aware
    # vertical/tone/facts detection) instead of keyword matching. Requires the
    # matching provider credential too; the runner still degrades to the stub
    # analyzer on a hard provider error.
    brief_analyzer_llm: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()