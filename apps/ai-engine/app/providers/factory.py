"""Provider factory — builds a provider per model class from routing config.

The registry maps provider plugins untouched by business code; adding a vendor
means adding a class here + a config line, nothing else.
"""

from __future__ import annotations

from app.config import Settings
from app.core.errors import RoutingConfigError
from app.providers.http_providers import AnthropicProvider, OllamaProvider, OpenAIProvider
from app.providers.protocol import StructuredLLMProvider
from app.providers.stub import StubProvider
from app.routing.config import RoutingConfig

_HTTP_PROVIDERS: dict[str, type] = {
    "openai": OpenAIProvider,
    "anthropic": AnthropicProvider,
    "ollama": OllamaProvider,
}


class ProviderRegistry:
    """One provider instance per model class (stub shared by default).

    `force_for_tests(model_class, provider)` pins a double for a model class so
    repair-ladder and failure-injection tests never touch a real vendor.
    """

    def __init__(self, settings: Settings, routing: RoutingConfig) -> None:
        self.settings = settings
        self.routing = routing
        self._stub = StubProvider()
        self._built: dict[str, StructuredLLMProvider] = {}
        self._overrides: dict[str, StructuredLLMProvider] = {}

    def force_for_tests(self, model_class: str, provider: StructuredLLMProvider) -> None:
        self._overrides[model_class] = provider

    def get(self, model_class: str) -> StructuredLLMProvider:
        """Return the provider instance for a routing model class."""
        if model_class in self._overrides:
            return self._overrides[model_class]
        model_def = self.routing.model(model_class)
        if model_def.provider == "stub":
            return self._stub
        key = f"{model_def.provider}:{model_class}"
        if key not in self._built:
            self._built[key] = self._build_http(model_def.provider)
        return self._built[key]

    def _build_http(self, provider_name: str) -> StructuredLLMProvider:
        cls = _HTTP_PROVIDERS.get(provider_name)
        if cls is None:
            raise RoutingConfigError(f"unknown provider plugin {provider_name!r} (E-AI-006)")
        if provider_name == "ollama":
            return cls("", self.settings.ollama_base_url)
        if provider_name == "openai":
            if not self.settings.openai_api_key:
                raise RoutingConfigError("openai provider selected but AI_OPENAI_API_KEY is unset")
            return cls(self.settings.openai_api_key, self.settings.openai_base_url)
        if not self.settings.anthropic_api_key:
            raise RoutingConfigError("anthropic provider selected but AI_ANTHROPIC_API_KEY is unset")
        return cls(self.settings.anthropic_api_key, self.settings.anthropic_base_url)