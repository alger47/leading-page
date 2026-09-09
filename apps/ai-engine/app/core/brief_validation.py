"""L0 brief validation (PART VIII §8.1): length caps, locale detection, injection
neutralization. Runs before any LLM call; violations block the job (E-AI-001).

The brief is never rewritten here — it stays DATA. `injection_detected` flips a
flag that is recorded on the job and enforced by the DATA framing already baked
into every prompt template.
"""

from __future__ import annotations

import re

from app.core.errors import BriefValidationError

_ARABIC_RE = re.compile(r"[\u0600-\u06FF]")
_FRENCH_TOKENS = {
    "à", "en", "un", "une", "des", "du", "au", "aux", "le", "la", "les",
    "pour", "avec", "sur", "sans", "notre", "votre", "merci",
    "cuisine", "famille", "hôtel", "boutique", "voyage", "réservation", "réserver",
}
_FRENCH_ACCENT = re.compile(r"[àâçéèêëîïôœùûü]", re.IGNORECASE)

# Instruction-looking phrasing inside a brief (case-insensitive). Detected and
# recorded; the DATA framing in prompts is the enforcement layer, detection is
# the safety net that makes it visible in telemetry.
_INJECTION_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"ignore\s+(?:the\s+|these\s+)?(?:(?:above|previous|system|earlier)\s+)?instructions", re.IGNORECASE),
    re.compile(r"disregard\s+(?:the\s+)?(?:above|previous|system)", re.IGNORECASE),
    re.compile(r"you\s+are\s+now", re.IGNORECASE),
    re.compile(r"from\s+now\s+on", re.IGNORECASE),
    re.compile(r"\b(set|change|override|ignore)\b.{0,40}\binstead\b", re.IGNORECASE),
    re.compile(r"jailbreak", re.IGNORECASE),
    re.compile(r"\bprint\s+the\s+(?:system\s+)?prompt", re.IGNORECASE),
    re.compile(r"<system|</", re.IGNORECASE),
    re.compile(r"\{\{\s*system", re.IGNORECASE),
    re.compile(r"system\s+prompt:", re.IGNORECASE),
    re.compile(r"\b(expose|reveal)\b.{0,30}(?:hidden|prompt|instructions)", re.IGNORECASE),
)


def validate_brief(raw: str, max_length: int = 4000) -> dict:
    """L0 check. Returns normalized brief + flags; raises BriefValidationError."""
    brief = (raw or "").strip()
    if not brief:
        raise BriefValidationError("brief must not be empty")
    if len(brief) > max_length:
        raise BriefValidationError(f"brief exceeds {max_length} chars")
    return {
        "brief": brief,
        "length": len(brief),
        "locale": detect_locale(brief),
        "injection_detected": detect_injection(brief),
    }


def detect_locale(text: str, hint: str | None = None) -> str:
    if hint in ("ar", "fr", "en"):
        return hint
    if _ARABIC_RE.search(text):
        return "ar"
    words = {w.lower() for w in re.findall(r"[a-zàâæçéèêëîïôœùûüÿ'-]+", text, re.IGNORECASE)}
    hits = len(words & _FRENCH_TOKENS) + (1 if _FRENCH_ACCENT.search(text) is not None else 0)
    if hits >= 2:
        return "fr"
    return "en"


def detect_injection(text: str) -> bool:
    return any(p.search(text) is not None for p in _INJECTION_PATTERNS)