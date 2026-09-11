"""Shared pytest fixtures. All pipeline tests run against the stub provider unless
a test overrides `provider_overrides` via build_container."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

# Hermetic tests: a developer's local key/.env (apps/ai-engine/.env, gitignored)
# must NEVER leak into the test process. Force the stub routing config and clear
# HTTP credentials before the first Settings() is constructed, otherwise the
# provider factory builds real OpenAI/Anthropic clients and tests hit a live API.
_ROOT = Path(__file__).resolve().parents[1]
os.environ["AI_ROUTING_CONFIG_PATH"] = str(_ROOT / "config" / "routing.yaml")
os.environ["AI_OPENAI_API_KEY"] = ""
os.environ["AI_ANTHROPIC_API_KEY"] = ""
os.environ["AI_BRIEF_ANALYZER_LLM"] = "false"

from app.api.container import build_container  # noqa: E402
from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402

AUTH_HEADERS = {"X-Internal-Token": "dev-internal-token"}

BRIEF_SAMPLE = "Boutique hotel near the old town. Target: couples for a relaxing weekend."


@pytest.fixture(scope="session")
def settings() -> Settings:
    return Settings()


@pytest.fixture
def container():
    return build_container()


@pytest.fixture
def client(container):
    app = create_app(container=container)
    from fastapi.testclient import TestClient

    with TestClient(app) as c:
        yield c


@pytest.fixture
def auth_headers() -> dict:
    return dict(AUTH_HEADERS)


@pytest.fixture
def brief_sample() -> str:
    return BRIEF_SAMPLE