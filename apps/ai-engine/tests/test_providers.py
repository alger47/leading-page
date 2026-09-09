"""Provider abstraction and factory seams."""

from __future__ import annotations

import asyncio

import pytest

from app.api.container import build_container
from app.providers.protocol import GenerationParams
from app.providers.stub import StubProvider
from tests.helpers import FlakyProvider


@pytest.fixture
def stub(container) -> StubProvider:
    return container.providers.get(container.routing.stages["brief-analyzer"].model_class)


def test_stub_is_deterministic(container, stub) -> None:
    prompt = container.prompts.get("stage1-brief-analyzer")
    schema = container.schemas.load("brief_analyzer.output.json")

    async def call() -> dict:
        return (await stub.generate_structured(
            schema=schema,
            prompt=prompt,
            inputs={"brief": "Boutique hotel", "locale": "en"},
            params=GenerationParams(model="stub-fast"),
        )).data or {}

    first, second = asyncio.run(call()), asyncio.run(call())
    assert first == second


def test_factory_force_for_tests_overrides_model_class(container) -> None:
    flaky = FlakyProvider()
    overridden = build_container(provider_overrides={"fast": flaky})
    assert overridden.providers.get("fast") is flaky
    assert overridden.providers.get("premium") is not flaky


def test_unknown_model_class_fails(container) -> None:
    from app.core.errors import RoutingConfigError

    with pytest.raises(RoutingConfigError):
        container.providers.get("does-not-exist")