"""Prompt asset store: loads versioned YAML assets from app/prompts/*.yaml."""

from __future__ import annotations

from pathlib import Path

from app.core.errors import RoutingConfigError
from app.core.schema_store import SchemaStore
from app.prompts.assets import PromptAsset

PROMTP_DIR = Path(__file__).resolve().parent


class PromptStore:
    """Index of all registered prompt assets, keyed by name.

    Prompts are registered at startup; an unknown name is a hard error
    (E-AI-006), never a silent fallback with an inline string.
    """

    def __init__(self, directory: Path = PROMTP_DIR, schemas: SchemaStore | None = None) -> None:
        self.directory = directory
        self.schemas = schemas or SchemaStore()
        self._assets: dict[str, PromptAsset] = {}
        self._load()

    def _load(self) -> None:
        for path in sorted(self.directory.glob("*.yaml")):
            asset = PromptAsset.from_yaml(path.read_text(encoding="utf-8"))
            if asset.name in self._assets:
                raise RoutingConfigError(f"duplicate prompt name: {asset.name}")
            self._assets[asset.name] = asset
        for name, asset in self._assets.items():
            input_schema = self.schemas.load(asset.inputs_schema)
            self.schemas.load(asset.output_schema)
            for slot in input_schema.get("required") or []:
                if f"{{{slot}}}" not in asset.user_template:
                    raise RoutingConfigError(
                        f"prompt {name!r} user_template lacks input slot {{{slot}}}"
                    )

    def get(self, name: str) -> PromptAsset:
        asset = self._assets.get(name)
        if asset is None:
            raise RoutingConfigError(f"unknown prompt asset: {name!r} (E-AI-006)")
        return asset

    def has(self, name: str) -> bool:
        return name in self._assets

    def refs(self) -> list[str]:
        return sorted(a.ref for a in self._assets.values())

    def names(self) -> list[str]:
        return sorted(self._assets)