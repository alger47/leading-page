"""Provider abstraction and factory seams."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from app.api.container import build_container
from app.prompts.assets import PromptAsset
from app.providers.http_providers import _is_strict_compatible
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


def test_strict_compatible_closed_object() -> None:
    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {"name": {"type": "string"}},
    }
    assert _is_strict_compatible(schema) is True


def test_strict_compatible_open_object() -> None:
    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {"items": {"type": "object", "additionalProperties": True}},
    }
    assert _is_strict_compatible(schema) is False


def test_strict_compatible_array_of_closed_objects() -> None:
    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "list": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {"x": {"type": "string"}},
                },
            }
        },
    }
    assert _is_strict_compatible(schema) is True


def test_strict_compatible_page_planner_is_open() -> None:
    from app.core.schema_store import SchemaStore

    schema = SchemaStore().load("page_planner.output.json")
    assert _is_strict_compatible(schema) is False


class _FakeResp:
    status_code = 200

    def __init__(self, content: str) -> None:
        self._content = content

    def json(self) -> dict:
        return {"choices": [{"message": {"content": self._content}}]}


class _FakeClient:
    def __init__(self, content: str) -> None:
        self._content = content

    async def post(self, url: str, headers=None, json=None) -> _FakeResp:
        return _FakeResp(self._content)


def test_openai_provider_non_object_output_is_malformed() -> None:
    from app.prompts.assets import PromptAsset
    from app.providers.http_providers import OpenAIProvider
    from app.providers.protocol import Outcome

    provider = OpenAIProvider(
        api_key="x",
        base_url="https://api.example.com/v1",
        client=_FakeClient('["bare","array"]'),
    )
    prompt = PromptAsset(
        name="stage-t",
        version="1.0.0",
        model_class="fast",
        temperature=0,
        inputs_schema="x.input.json",
        output_schema="x.output.json",
        system="s",
        user_template="{v}",
    )

    async def call() -> Any:
        return await provider.generate_structured(
            schema={"type": "object", "additionalProperties": True},
            prompt=prompt,
            inputs={"v": "hi"},
            params=GenerationParams(model="m"),
        )

    res = asyncio.run(call())
    assert res.outcome is Outcome.malformed
    assert "not a JSON object" in res.message


def test_openai_provider_unparseable_output_is_malformed() -> None:
    from app.prompts.assets import PromptAsset
    from app.providers.http_providers import OpenAIProvider
    from app.providers.protocol import Outcome

    provider = OpenAIProvider(
        api_key="x",
        base_url="https://api.example.com/v1",
        client=_FakeClient("not json at all"),
    )
    prompt = PromptAsset(
        name="stage-t",
        version="1.0.0",
        model_class="fast",
        temperature=0,
        inputs_schema="x.input.json",
        output_schema="x.output.json",
        system="s",
        user_template="{v}",
    )

    async def call() -> Any:
        return await provider.generate_structured(
            schema={"type": "object", "additionalProperties": True},
            prompt=prompt,
            inputs={"v": "hi"},
            params=GenerationParams(model="m"),
        )

    res = asyncio.run(call())
    assert res.outcome is Outcome.malformed


def test_openai_provider_sends_json_schema_response_format() -> None:
    from app.prompts.assets import PromptAsset
    from app.providers.http_providers import OpenAIProvider
    from app.providers.protocol import Outcome

    captured: dict = {}

    class _CapturingClient(_FakeClient):
        def __init__(self) -> None:
            super().__init__('{"ok": true}')

        async def post(self, url, headers=None, json=None) -> _FakeResp:
            captured["payload"] = json
            return _FakeResp(self._content)

    provider = OpenAIProvider(api_key="x", base_url="https://api.example.com/v1", client=_CapturingClient())
    prompt = PromptAsset(
        name="stage-t",
        version="1.0.0",
        model_class="fast",
        temperature=0,
        inputs_schema="x.input.json",
        output_schema="x.output.json",
        system="s",
        user_template="{v}",
    )

    async def call() -> Any:
        return await provider.generate_structured(
            schema={"type": "object", "additionalProperties": False, "properties": {"ok": {"type": "boolean"}}},
            prompt=prompt,
            inputs={"v": "hi"},
            params=GenerationParams(model="m"),
        )

    res = asyncio.run(call())
    assert res.outcome is Outcome.ok
    rf = captured["payload"]["response_format"]
    assert rf["type"] == "json_schema"
    assert rf["json_schema"]["strict"] is True


def test_openai_provider_open_schema_falls_back_to_json_object() -> None:
    from app.prompts.assets import PromptAsset
    from app.providers.http_providers import OpenAIProvider
    from app.providers.protocol import Outcome

    captured: dict = {}

    class _CapturingClient(_FakeClient):
        def __init__(self) -> None:
            super().__init__('{"ok": true}')

        async def post(self, url, headers=None, json=None) -> _FakeResp:
            captured["payload"] = json
            return _FakeResp(self._content)

    provider = OpenAIProvider(api_key="x", base_url="https://api.example.com/v1", client=_CapturingClient())
    prompt = PromptAsset(
        name="stage-t",
        version="1.0.0",
        model_class="fast",
        temperature=0,
        inputs_schema="x.input.json",
        output_schema="x.output.json",
        system="s",
        user_template="{v}",
    )

    async def call() -> Any:
        return await provider.generate_structured(
            schema={"type": "object", "additionalProperties": True},  # open slot, strict providers reject
            prompt=prompt,
            inputs={"v": "hi"},
            params=GenerationParams(model="m"),
        )

    res = asyncio.run(call())
    assert res.outcome is Outcome.ok
    assert captured["payload"]["response_format"] == {"type": "json_object"}


def test_ollama_provider_sends_json_object_response_format() -> None:
    from app.prompts.assets import PromptAsset
    from app.providers.http_providers import OllamaProvider
    from app.providers.protocol import Outcome

    captured: dict = {}

    class _CapturingClient(_FakeClient):
        def __init__(self) -> None:
            super().__init__('{"ok": true}')

        async def post(self, url, headers=None, json=None) -> _FakeResp:
            captured["payload"] = json
            return _FakeResp(self._content)

    provider = OllamaProvider(api_key="", base_url="http://localhost:11434/v1", client=_CapturingClient())
    prompt = PromptAsset(
        name="stage-t",
        version="1.0.0",
        model_class="fast",
        temperature=0,
        inputs_schema="x.input.json",
        output_schema="x.output.json",
        system="s",
        user_template="{v}",
    )

    async def call() -> Any:
        return await provider.generate_structured(
            schema={"type": "object", "additionalProperties": True},
            prompt=prompt,
            inputs={"v": "hi"},
            params=GenerationParams(model="llama3.1"),
        )

    res = asyncio.run(call())
    assert res.outcome is Outcome.ok
    assert captured["payload"]["response_format"] == {"type": "json_object"}


def test_ollama_factory_builds_keyless_provider(tmp_path) -> None:
    import yaml

    from app.config import Settings
    from app.providers.http_providers import OllamaProvider

    route = tmp_path / "routing.yaml"
    route.write_text(
        yaml.safe_dump(
            {
                "models": {"fast": {"provider": "ollama", "model_id": "llama3.1"}},
                "stages": {"brief-analyzer": {"prompt": "stage1-brief-analyzer", "model_class": "fast"}},
                "job": {"max_total_attempts": 18, "default_budget_usd": 0.25},
            }
        ),
        encoding="utf-8",
    )
    settings = Settings(routing_config_path=route, ollama_base_url="http://127.0.0.1:11434/v1")
    built = build_container(settings=settings)
    provider = built.providers.get("fast")
    assert isinstance(provider, OllamaProvider)
    assert provider.base_url == "http://127.0.0.1:11434/v1"


def _write_minimal_routing(tmp_path, provider: str, model_id: str) -> None:
    import yaml

    route = tmp_path / "routing.yaml"
    route.write_text(
        yaml.safe_dump(
            {
                "models": {"fast": {"provider": provider, "model_id": model_id}},
                "stages": {"brief-analyzer": {"prompt": "stage1-brief-analyzer", "model_class": "fast"}},
                "job": {"max_total_attempts": 18, "default_budget_usd": 0.25},
            }
        ),
        encoding="utf-8",
    )


def test_qwen_factory_builds_with_key_and_base_url(tmp_path) -> None:
    from app.config import Settings
    from app.providers.http_providers import QwenProvider

    _write_minimal_routing(tmp_path, "qwen", "qwen-plus")
    settings = Settings(
        routing_config_path=tmp_path / "routing.yaml",
        qwen_api_key="k",
        qwen_base_url="http://127.0.0.1:8002/v1",
    )
    provider = build_container(settings=settings).providers.get("fast")
    assert isinstance(provider, QwenProvider)
    assert provider.base_url == "http://127.0.0.1:8002/v1"


def test_local_factory_builds_keyless(tmp_path) -> None:
    from app.config import Settings
    from app.providers.http_providers import LocalCompatibleProvider

    _write_minimal_routing(tmp_path, "local", "vllm-model")
    settings = Settings(routing_config_path=tmp_path / "routing.yaml", local_base_url="http://127.0.0.1:8001/v1")
    provider = build_container(settings=settings).providers.get("fast")
    assert isinstance(provider, LocalCompatibleProvider)
    assert provider.base_url == "http://127.0.0.1:8001/v1"


def test_gateway_providers_require_their_keys(tmp_path) -> None:
    from app.config import Settings
    from app.core.errors import RoutingConfigError

    for provider, settings in (
        ("gemini", Settings(routing_config_path=tmp_path / "routing.yaml")),
        ("qwen", Settings(routing_config_path=tmp_path / "routing.yaml")),
        ("openai", Settings(routing_config_path=tmp_path / "routing.yaml")),
    ):
        _write_minimal_routing(tmp_path, provider, "m")
        with pytest.raises(RoutingConfigError):
            build_container(settings=settings).providers.get("fast")


def test_gemini_provider_builds_with_key(tmp_path) -> None:
    from app.config import Settings
    from app.providers.http_providers import GeminiProvider

    _write_minimal_routing(tmp_path, "gemini", "gemini-2.0-flash")
    settings = Settings(
        routing_config_path=tmp_path / "routing.yaml",
        gemini_api_key="k",
        gemini_base_url="https://generativelanguage.googleapis.com/v1beta",
    )
    provider = build_container(settings=settings).providers.get("fast")
    assert isinstance(provider, GeminiProvider)
    assert provider._endpoint("gemini-2.0-flash").startswith(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"
    )


class _GeminiFakeResp:
    status_code = 200

    def __init__(self, body: dict) -> None:
        self._body = body

    def json(self) -> dict:
        return self._body


class _GeminiFakeClient:
    def __init__(self, body: dict) -> None:
        self._body = body
        self.captured: dict = {}

    async def post(self, url: str, headers=None, json=None) -> _GeminiFakeResp:
        self.captured["payload"] = json
        return _GeminiFakeResp(self._body)


def _prompt_asset() -> PromptAsset:
    return PromptAsset(
        name="stage-t",
        version="1.0.0",
        model_class="fast",
        temperature=0,
        inputs_schema="x.input.json",
        output_schema="x.output.json",
        system="s",
        user_template="{v}",
    )


def test_gemini_provider_parses_candidates_and_usage() -> None:
    from app.providers.http_providers import GeminiProvider
    from app.providers.protocol import Outcome

    client = _GeminiFakeClient(
        {
            "candidates": [{"content": {"parts": [{"text": '{"ok": true}'}]}}],
            "usageMetadata": {"promptTokenCount": 11, "candidatesTokenCount": 3},
        }
    )
    provider = GeminiProvider(api_key="k", base_url="https://api.example.com/v1beta", client=client)

    async def call() -> Any:
        return await provider.generate_structured(
            schema={"type": "object", "additionalProperties": True},
            prompt=_prompt_asset(),
            inputs={"v": "hi"},
            params=GenerationParams(model="gemini-2.0-flash"),
        )

    res = asyncio.run(call())
    assert res.outcome is Outcome.ok
    assert res.data == {"ok": True}
    assert res.usage.input_tokens == 11
    assert res.usage.output_tokens == 3
    gc = client.captured["payload"]
    assert gc["generationConfig"]["responseMimeType"] == "application/json"
    assert "responseSchema" not in gc["generationConfig"]
    assert client.captured["payload"]["contents"][0]["parts"][0]["text"] == "hi"


def test_gemini_provider_non_object_output_is_malformed() -> None:
    from app.providers.http_providers import GeminiProvider
    from app.providers.protocol import Outcome

    client = _GeminiFakeClient({"candidates": [{"content": {"parts": [{"text": "[1,2]"}]}}]})
    provider = GeminiProvider(api_key="k", base_url="https://api.example.com/v1beta", client=client)

    async def call() -> Any:
        return await provider.generate_structured(
            schema={"type": "object", "additionalProperties": True},
            prompt=_prompt_asset(),
            inputs={"v": "hi"},
            params=GenerationParams(model="m"),
        )

    res = asyncio.run(call())
    assert res.outcome is Outcome.malformed


def test_qwen_and_local_send_json_object_response_format() -> None:
    from app.providers.http_providers import LocalCompatibleProvider, QwenProvider
    from app.providers.protocol import Outcome

    def _run(cls: Any, api_key: str) -> None:
        captured: dict = {}

        class _Capturing(_FakeClient):
            def __init__(self) -> None:
                super().__init__('{"ok": true}')

            async def post(self, url, headers=None, json=None) -> _FakeResp:
                captured["payload"] = json
                return _FakeResp(self._content)

        provider = cls(api_key=api_key, base_url="https://api.example.com/v1", client=_Capturing())

        async def call() -> Any:
            return await provider.generate_structured(
                schema={"type": "object", "additionalProperties": True},
                prompt=_prompt_asset(),
                inputs={"v": "hi"},
                params=GenerationParams(model="m"),
            )

        res = asyncio.run(call())
        assert res.outcome is Outcome.ok
        assert captured["payload"]["response_format"] == {"type": "json_object"}

    _run(QwenProvider, "@unused@")
    _run(LocalCompatibleProvider, "")