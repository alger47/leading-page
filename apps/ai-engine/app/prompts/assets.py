"""Versioned prompt assets (PART VI §6.6-6.7).

Prompts are production assets: name@version, model_class, temperature, JSON Schema
referencing, explicit negative constraints, and injection-resistant brief framing.
Never inline prompt text in business code.
"""

import json
import re
from re import Pattern
from typing import Any

import yaml
from pydantic import BaseModel, Field, field_validator

_SLOT_RE = re.compile(r"\{([A-Za-z_][A-Za-z0-9_.]*)\}")


class PromptAsset(BaseModel):
    name: str
    version: str
    model_class: str
    temperature: float = Field(ge=0.0, le=1.0)
    inputs_schema: str = Field(min_length=1)
    output_schema: str = Field(min_length=1)
    system: str = Field(min_length=1)
    user_template: str = Field(min_length=1)
    few_shot: list[str] = Field(default_factory=list)

    @property
    def ref(self) -> str:
        return f"{self.name}@{self.version}"

    @field_validator("version")
    @classmethod
    def _check_version(cls, v: str) -> str:
        parts = v.split(".")
        if len(parts) != 3 or not all(p.isdigit() for p in parts):
            raise ValueError(f"version must be semver-ish (x.y.z), got: {v!r}")
        return v

    def render(self, inputs: dict[str, Any], injections: list[str] | None = None) -> str:
        """Render user_template substituting known slots only.

        Uses the DATA framing so a brief is never treated as instructions.
        Literal braces in prompt prose (e.g. describing JSON shapes) pass
        through untouched; only {known_slot} placeholders are replaced.
        Missing required slots are a bug and raise KeyError.
        """
        def _replace(match: "re.Match[str]") -> str:
            key = match.group(1)
            if key not in inputs:
                raise KeyError(f"prompt slot missing: {key}")
            value = inputs[key]
            if isinstance(value, str):
                return value
            return json.dumps(value, ensure_ascii=False)

        return _SLOT_RE.sub(_replace, self.user_template)

    @classmethod
    def from_yaml(cls, text: str) -> "PromptAsset":
        return cls(**yaml.safe_load(text))


# Regex patterns the BRF smuggling check uses (see registry.compile_injection_patterns).
SMUGGLING_PATTERNS: tuple[tuple[Pattern[str], str], ...] = ()


def compile_smuggling_patterns() -> tuple[tuple[Pattern[str], str], ...]:
    return SMUGGLING_PATTERNS