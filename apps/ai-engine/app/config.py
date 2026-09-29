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
    # Local Ollama (OpenAI-compatible endpoint); keyless.
    ollama_base_url: str = "http://localhost:11434/v1"
    # Gemini (Google) key + API base; keyless otherwise, provider unavailable.
    gemini_api_key: str = ""
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta"
    # Qwen Cloud / DashScope via the OpenAI-compatible endpoint.
    qwen_api_key: str = ""
    qwen_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    # Any OpenAI-compatible local endpoint (vLLM / LM Studio / llama.cpp ...).
    # Key is optional; a gateway behind auth sets AI_LOCAL_API_KEY.
    local_api_key: str = ""
    local_base_url: str = "http://localhost:8001/v1"

    # Phase 13: route ONLY the brief-analyzer through an LLM (LLM-aware
    # vertical/tone/facts detection) instead of keyword matching. Requires the
    # matching provider credential too; the runner still degrades to the stub
    # analyzer on a hard provider error.
    brief_analyzer_llm: bool = False

    # Stage 6 asset-renderer (image generation). Feature is OFF by default:
    # pipeline runs skip stage 6 unless a provider is enabled here AND the
    # request opted in. `stub` is for tests/dev/CI; `huggingface` calls the
    # Hugging Face Inference API with AI_IMAGE_HF_TOKEN; `pollinations` calls
    # the tokenless Pollinations API (zero-credential fallback).
    image_provider: str = "off"  # off | stub | huggingface | pollinations
    image_hf_token: str = ""
    image_hf_base_url: str = "https://router.huggingface.co/hf-inference/models"
    # Empty => the images.<key>.model_id from the routing config wins.
    image_hf_model: str = ""
    image_pollinations_base_url: str = "https://image.pollinations.ai/prompt"
    image_pollinations_model: str = ""  # empty => vendor default model
    # Ordered pollinations mirror base URLs (comma-separated). Empty => the
    # single AI_IMAGE_POLLINATIONS_BASE_URL. A transient failure falls through
    # to the next mirror for the SAME prompt; 4xx/oversize are not retried.
    image_pollinations_base_urls: str = ""
    # Bounded per-image retry (SAME prompt => SAME seed => SAME raster):
    # `image_retries` tries total (0 = no retry); the delay applies between
    # attempts so the vendor's edge recovers from a transient 5xx/429.
    image_retries: int = 1
    image_retry_delay_s: float = 2.5
    # Deterministic seed mode: "prompt-sha" derives a per-prompt seed from
    # sha256(prompt) so a retry re-renders the SAME image; a plain integer pins
    # every generated image to that one seed. Any other value disables seeding.
    image_seed: str = "prompt-sha"
    # Empty => orientation-aware defaults (landscape 1536x1024, portrait 1024x1536,
    # square 1344x1344) so browser cover-crops never upscale generated pixels.
    # An explicit AI_IMAGE_SIZE (WIDTHxHEIGHT) unwins those defaults.
    image_size: str = ""
    image_max: int = 4  # max raster images generated per job
    image_max_bytes: int = 800_000  # per-image transfer cap (bytes)
    image_timeout_s: float = 120.0


@lru_cache
def get_settings() -> Settings:
    return Settings()


def inter_stage_delay(settings: Settings) -> float:
    """Pause between LLM stages, only when a real provider is configured."""
    if settings.openai_api_key or settings.anthropic_api_key:
        return 30.0
    return 0.0