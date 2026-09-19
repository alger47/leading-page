"""Provider factory — builds a provider per model class from routing config.

The registry maps provider plugins untouched by business code; adding a vendor
means adding a class here + a config line, nothing else.
"""

from __future__ import annotations

from app.config import Settings
from app.core.errors import RoutingConfigError
from app.providers.http_providers import (
    AnthropicProvider,
    GeminiProvider,
    LocalCompatibleProvider,
    OllamaProvider,
    OpenAIProvider,
    QwenProvider,
)
from app.providers.image_providers import HuggingFaceImageProvider, PollinationsImageProvider
from app.providers.protocol import ImageProvider, StructuredLLMProvider
from app.providers.stub import StubImageProvider, StubProvider
from app.routing.config import RoutingConfig

_HTTP_PROVIDERS: dict[str, type] = {
    "openai": OpenAIProvider,
    "anthropic": AnthropicProvider,
    "ollama": OllamaProvider,
    "gemini": GeminiProvider,
    "qwen": QwenProvider,
    "local": LocalCompatibleProvider,
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
        self._stub_image = StubImageProvider()
        self._built: dict[str, StructuredLLMProvider] = {}
        self._image_built: dict[str, ImageProvider] = {}
        self._overrides: dict[str, StructuredLLMProvider] = {}
        self._image_override: ImageProvider | None = None

    def force_for_tests(self, model_class: str, provider: StructuredLLMProvider) -> None:
        self._overrides[model_class] = provider

    def force_image_for_tests(self, provider: ImageProvider) -> None:
        self._image_override = provider

    def image_provider(self) -> ImageProvider | None:
        """Image provider for Stage 6, or None when the feature is off.

        Driven by AI_IMAGE_PROVIDER (off | stub | huggingface | pollinations).
        `stub` is used by tests/dev/CI; `huggingface` requires a token and an
        images: section in the routing config; `pollinations` needs no
        credential. A request-level flag also gates the pipeline, so image
        generation stays OFF by default in production.
        """
        if self._image_override is not None:
            return self._image_override
        mode = self.settings.image_provider
        if mode in ("off", ""):
            return None
        if mode == "stub":
            return self._stub_image
        if mode == "pollinations":
            key = f"pollinations:{self.settings.image_pollinations_model or 'default'}"
            if key not in self._image_built:
                self._image_built[key] = PollinationsImageProvider(
                    base_url=self.settings.image_pollinations_base_url,
                    model=self.settings.image_pollinations_model,
                    timeout_s=self.settings.image_timeout_s,
                )
            return self._image_built[key]
        if mode == "huggingface":
            if not self.settings.image_hf_token:
                raise RoutingConfigError("AI_IMAGE_PROVIDER=huggingface but AI_IMAGE_HF_TOKEN is unset (E-AI-006)")
            image_def = self.routing.image()
            model_id = self.settings.image_hf_model or image_def.model_id
            key = f"huggingface:{model_id}"
            if key not in self._image_built:
                self._image_built[key] = HuggingFaceImageProvider(
                    token=self.settings.image_hf_token,
                    model=model_id,
                    base_url=self.settings.image_hf_base_url,
                    timeout_s=self.settings.image_timeout_s,
                )
            return self._image_built[key]
        raise RoutingConfigError(f"unknown AI_IMAGE_PROVIDER {mode!r} (E-AI-006)")

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
        if provider_name == "local":
            return cls(self.settings.local_api_key, self.settings.local_base_url)
        if provider_name == "gemini":
            if not self.settings.gemini_api_key:
                raise RoutingConfigError("gemini provider selected but AI_GEMINI_API_KEY is unset")
            return cls(self.settings.gemini_api_key, self.settings.gemini_base_url)
        if provider_name == "qwen":
            if not self.settings.qwen_api_key:
                raise RoutingConfigError("qwen provider selected but AI_QWEN_API_KEY is unset")
            return cls(self.settings.qwen_api_key, self.settings.qwen_base_url)
        if provider_name == "openai":
            if not self.settings.openai_api_key:
                raise RoutingConfigError("openai provider selected but AI_OPENAI_API_KEY is unset")
            return cls(self.settings.openai_api_key, self.settings.openai_base_url)
        if not self.settings.anthropic_api_key:
            raise RoutingConfigError("anthropic provider selected but AI_ANTHROPIC_API_KEY is unset")
        return cls(self.settings.anthropic_api_key, self.settings.anthropic_base_url)