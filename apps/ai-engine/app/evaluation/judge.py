"""LLM-as-judge (PART IX §9.4) — advisory, never a lone gate.

The judge scores an assembled page against the versioned rubric: structural
correctness, semantic coherence, copy quality (locale-aware), CTA strength,
visual composition, accessibility, SEO completeness. It returns structured
scores + reasons.

Two implementations behind one interface:

- ``LLMJudge``: a pinned model (routing model class `judge`, default gpt-4o-mini)
  with the versioned judge prompt. Used only when the configured provider has
  valid credentials.
- ``StubJudge``: a deterministic, rule-based surrogate used in tests/dev/CI
  (and whenever the real provider is unavailable). It is EXPLICITLY not
  calibrated against human quality — every report carries the judge mode +
  ref so the reader can tell the difference.

``create_judge`` picks the right implementation from the container.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.core.errors import RoutingConfigError
from app.evaluation.rubric import Rubric, load_rubric
from app.prompts.assets import PromptAsset
from app.providers.protocol import GenerationParams, StructuredLLMProvider

STUB_JUDGE_REF = "stub:runtime?not-calibrated"
STUB_JUDGE_SUMMARY = (
    "Deterministic rule-based surrogate judge — NOT calibrated against human quality; "
    "enable the pinned LLM judge (AI_OPENAI_API_KEY) for real scores."
)


@dataclass
class JudgeScore:
    case_id: str
    rubric_ref: str
    mode: str  # "llm" | "stub"
    judge_ref: str
    scores: dict[str, int] = field(default_factory=dict)
    reasons: dict[str, str] = field(default_factory=dict)
    overall: int = 0
    usable: bool = False
    summary: str = ""
    error: str | None = None

    @property
    def calibrated(self) -> bool:
        return self.mode == "llm"

    def to_dict(self) -> dict[str, Any]:
        return {
            "case_id": self.case_id,
            "rubric": self.rubric_ref,
            "mode": self.mode,
            "judge": self.judge_ref,
            "scores": self.scores,
            "reasons": self.reasons,
            "overall": self.overall,
            "usable": self.usable,
            "summary": self.summary,
            "error": self.error,
        }


class Judge:
    """Common scoring entry point; subclasses implement _score."""

    def __init__(self, rubric: Rubric) -> None:
        self.rubric = rubric

    async def score(
        self,
        *,
        case_id: str,
        brief: str,
        locale: str,
        page: dict[str, Any],
    ) -> JudgeScore:
        page_json = _serialize(page)
        try:
            result = await self._score_impl(case_id=case_id, brief=brief, locale=locale, page_json=page_json)
        except Exception as exc:  # noqa: BLE001  advisory: provider failure is recorded, not fatal
            return self._failed(case_id=case_id, error=f"{type(exc).__name__}: {exc}")
        result.case_id = case_id
        return result

    async def _score_impl(self, *, case_id: str, brief: str, locale: str, page_json: str) -> JudgeScore:
        raise NotImplementedError

    def _failed(self, *, case_id: str, error: str) -> JudgeScore:
        return JudgeScore(
            case_id=case_id,
            rubric_ref=self.rubric.ref,
            mode=self.mode(),
            judge_ref=self.ref(),
            scores={},
            error=error,
        )

    def mode(self) -> str:
        raise NotImplementedError

    def ref(self) -> str:
        raise NotImplementedError


class StubJudge(Judge):
    """Deterministic rule-based surrogate (dev/CI, provider unavailable)."""

    def mode(self) -> str:
        return "stub"

    def ref(self) -> str:
        return STUB_JUDGE_REF

    async def _score_impl(self, *, case_id: str, brief: str, locale: str, page_json: str) -> JudgeScore:
        page = _loads(page_json) or {}
        sections: list[dict[str, Any]] = [
            (s or {}) for s in (page.get("sections") or [])
        ]
        types = [str(s.get("type", "")) for s in sections]

        envelope = page.get("page") or {}
        seo_raw = envelope.get("seo")
        seo: dict[Any, Any] = seo_raw if isinstance(seo_raw, dict) else {}

        hero = _first(sections, "hero")
        hero_content = hero.get("content") or {}
        cta = _first(sections, "cta")
        cta_content = cta.get("content") or {}
        features = _first(sections, "features")
        features_content = features.get("content") or {}
        items = features_content.get("items") or []

        reasons = {}

        def score_for(key: str) -> tuple[int, str]:
            if key == "structural":
                all_present = all(t in types for t in ("header", "hero", "features", "cta", "footer"))
                if all_present and len(types) <= 6:
                    return 5, "complete canonical section set, within bounds"
                if all_present:
                    return 4, "complete set, slightly above the 6-section bound"
                return 3, f"missing sections: {set({'header','hero','features','cta','footer'}) - set(types)}"
            if key == "coherence":
                if "hero" in types and "cta" in types and "features" in types:
                    return 4, "page addresses the brief goal (hero -> features -> cta)"
                return 3, "brief goal only partially reflected in sections"
            if key == "copy":
                t = _text(hero_content)
                cl = _cta_label(hero_content) or _cta_label(cta_content)
                if t and cl:
                    return 4, "natural locale copy with a clear primary CTA"
                if t:
                    return 3, "copy present but CTA label missing"
                return 2, "copy is empty"
            if key == "cta":
                if _cta_label(hero_content) and _cta_label(cta_content):
                    return 5, "primary CTA in hero and a closing CTA section"
                if _cta_label(hero_content) or _cta_label(cta_content):
                    return 4, "single clear primary CTA"
                return 2, "no clear call to action"
            if key == "visual":
                if len(items) >= 2 and features.get("variant"):
                    return 4, "balanced feature grid with a declared variant"
                if features.get("variant"):
                    return 3, "minimal grid, fewer than two items"
                return 3, "feature section missing variant"
            if key == "accessibility":
                # The Page Schema declares locale + direction at the page root
                # (envelope.schema.json); media slots carry alt text by schema,
                # so the rubric anchors on the declared locale/direction.
                if envelope.get("locale") and envelope.get("direction"):
                    return 4, "envelope declares locale + direction; media slots carry alt by schema"
                return 3, "locale/direction not both declared"
            if key == "seo":
                if (envelope.get("title") or seo.get("title")) and seo.get("description"):
                    return 4, "unique title + description and a heading hierarchy"
                return 3, "missing page title or SEO description"
            return 3, "no anchor available"

        scores: dict[str, int] = {}
        for crit in self.rubric.criteria:
            s, reason = score_for(crit.id)
            scores[crit.id] = s
            reasons[crit.id] = reason

        overall = round(sum(scores.values()) / len(scores)) if scores else 0
        usable = bool(scores) and all(s >= 3 for s in scores.values()) and overall >= 3
        return JudgeScore(
            case_id=case_id,
            rubric_ref=self.rubric.ref,
            mode=self.mode(),
            judge_ref=self.ref(),
            scores=scores,
            reasons=reasons,
            overall=max(overall, 1),
            usable=usable,
            summary=STUB_JUDGE_SUMMARY,
        )


class LLMJudge(Judge):
    """Pinned-model judge over the versioned judge prompt (advisory)."""

    def __init__(
        self,
        *,
        provider: StructuredLLMProvider,
        prompt: PromptAsset,
        rubric: Rubric,
        params: GenerationParams,
        output_schema: dict[str, Any],
    ) -> None:
        super().__init__(rubric=rubric)
        self.provider = provider
        self.prompt = prompt
        self.params = params
        self.output_schema = output_schema
        self._ref = f"{prompt.ref}::{provider.name}::{params.model}"

    def mode(self) -> str:
        return "llm"

    def ref(self) -> str:
        return self._ref

    async def _score_impl(self, *, case_id: str, brief: str, locale: str, page_json: str) -> JudgeScore:
        result = await self.provider.generate_structured(
            schema=self.output_schema,
            prompt=self.prompt,
            inputs={
                "brief": brief,
                "locale": locale,
                "page_json": page_json,
                "rubric_json": _serialize(self.rubric.model_dump()),
            },
            params=self.params,
        )
        if result.outcome.value != "ok" or result.data is None:
            return self._failed(case_id=case_id, error=f"provider outcome {result.outcome.value}: {result.message}")
        data = result.data
        scores = {str(k): int(v) for k, v in (data.get("scores") or {}).items()}
        reasons = {str(k): str(v) for k, v in (data.get("reasons") or {}).items()}
        overall = max(1, min(5, int(data.get("overall", 0))))
        usable = bool(data.get("usable"))
        return JudgeScore(
            case_id=case_id,
            rubric_ref=self.rubric.ref,
            mode=self.mode(),
            judge_ref=self.ref(),
            scores=scores,
            reasons=reasons,
            overall=overall,
            usable=usable,
            summary=str(data.get("summary", "")),
        )


def create_judge(container: Any, rubric: Rubric | None = None) -> Judge:
    """Resolve the judge from routing config; fall back to the stub judge.

    The pinned LLM judge is used only when routing pins `judge` to a real
    provider AND that provider has credentials (advisory scoring stays fully
    optional). Otherwise the deterministic StubJudge is returned so every eval
    run works offline.
    """
    rubric = rubric or load_rubric()
    try:
        model_def = container.routing.model("judge")
        provider = container.providers.get("judge")
    except RoutingConfigError:
        return StubJudge(rubric=rubric)
    if model_def.provider == "stub":
        return StubJudge(rubric=rubric)
    prompt = container.prompts.get("judge-rubric")
    output_schema = container.schemas.load("judge_scoring.output.json")
    params = GenerationParams(model=model_def.model_id, temperature=0.0, max_output_tokens=1024)
    return LLMJudge(
        provider=provider,
        prompt=prompt,
        rubric=rubric,
        params=params,
        output_schema=output_schema,
    )


# --------------------------------------------------------------------------- #
# small helpers
# --------------------------------------------------------------------------- #

def _serialize(obj: Any) -> str:
    return __import__("json").dumps(obj, ensure_ascii=False)


def _loads(text: str) -> dict[str, Any] | None:
    try:
        return __import__("json").loads(text)
    except (ValueError, TypeError):
        return None


def _first(sections: list[dict[str, Any]], type_: str) -> dict[str, Any]:
    for s in sections:
        if s.get("type") == type_:
            return s
    return {}


def _text(content: dict[str, Any]) -> str:
    for key in ("title", "subtitle", "eyebrow"):
        val = content.get(key)
        if isinstance(val, str) and val.strip() and "[" not in val[:6]:
            return val
    return ""


def _cta_label(content: dict[str, Any]) -> str:
    cta = content.get("primaryCta")
    if isinstance(cta, dict):
        label = cta.get("label")
        if isinstance(label, str) and label.strip():
            return label
    if isinstance(cta, str) and cta.strip():
        return cta
    return ""