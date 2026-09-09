"""Shared pytest fixtures. All pipeline tests run against the stub provider unless
a test overrides `provider_overrides` via build_container."""

from __future__ import annotations

import pytest

from app.api.container import build_container
from app.config import Settings
from app.main import create_app

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