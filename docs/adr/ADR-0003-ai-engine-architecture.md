# ADR-0003: AI Engine Architecture — Provider Abstraction, Versioned Prompts, Honest Failure

**Status:** accepted  
**Date:** 2026-09-09  
**Deciders:** Platform architect

---

## Context

Phase 4 builds the AI Engine: a FastAPI service that turns a plain-language
brief into structured stage outputs (analysis → page plan → layout → content →
asset requirements). Per the master prompt (PART VI), the engine must:

- bind every LLM call to a JSON Schema (structured output / tool calling),
- route models **by configuration, not code** (§6.3),
- treat prompts as versioned production assets (§6.6–6.7),
- repair invalid output through a bounded ladder and **fail honestly** if it
  cannot — never fake a success (PD-05),
- track per-attempt cost and per-job budgets (§6.9),
- block obvious abuse at an L0 gate before any LLM call (§8.1),
- be testable and cheap in CI via a deterministic stub provider,
- prove acceptance through a mini-eval on ≥10 golden briefs (§9.1–9.2).

## Decision

Single self-contained service `apps/ai-engine` (Python 3.12 + FastAPI) with
five exclusive integration points, all swim lanes enforced in CI:

1. **Provider abstraction** — business code may only talk to an LLM through a
   `StructuredLLMProvider` (Protocol). Implementations: `stub` (deterministic,
   offline), `openai`, `anthropic` (HTTP structured output). Vendors are wired
   in `config/routing.yaml`; a provider decision is therefore a config + eval,
   never code (§6.3).
2. **Versioned prompts** — every stage resolves through
   `PromptStore.get(name)` to a `PromptAsset` (`name@version`, model_class,
   temperature, input/output schema refs, system + user template, few-shot).
   No inline prompt strings in business code (§6.6). Prompt content is bundled
   and committed with the service.
3. **Config-driven routing** — per-stage `{prompt, model_class, temperature,
   max_attempts, fallbacks}` and per-model `{provider, model_id, cost}` live in
   `config/routing.yaml`. Unknown stage/model/prompt raises `E-AI-006` at
   startup (§6.3).
4. **Repair ladder + honest failure** — each stage runs
   generate → validate → retry (≤ max, schema errors fed back) → targeted
   re-ask (failing slots only) → deterministic local safe repair →
   stage fallback → job `FAILED E-AI-004`. Provider hard errors record one
   attempt then raise `E-AI-005` (no thrash loop) (§6.5, §8.1, PART IX).
5. **Cost ledger + budget** — one `JobLedger` per job: per-attempt
   tokens → estimated USD from routing costs; job-level attempt cap
   (`E-AI-003`) and budget (`E-AI-002`) enforced before/at spend (§6.9).

## Rationale

### Why FastAPI instead of an async worker-pool inside the CLI/editor

- HTTP is a clean boundary for a future Worker/web UI (Phase 4 acceptance
  drives the product); in-memory JobStore is enough for Phase 4 and swaps to
  PostgreSQL in Phase 6 (PART X).

### Why a Protocol rather than a base class / interface per vendor

- A `Protocol` lets test doubles (flaky/rigged/raising providers) conform
  structurally without inheritance, and keeps `provider.generate_structured`
  the single seam for fault injection in tests.

### Why the stub must never echo the brief

- Anti-hallucination is structural (§6.8): the stub derives outputs from local
  templates keyed by detected signals — it cannot repeat attacker text, so
  prompt-injection artifacts are structurally impossible and the pipeline
  machinery (L0 flag, DATA framing already baked into prompts) is what the
  injection golden case exercises.

### Why prompts are committed YAML assets (not DB rows yet)

- Assets version and review like code; the DB-backed prompt UI is the
  content-ops phase (Phase 8). `PromptStore` raises `E-AI-006` on unknown refs
  so a bad routing change fails loud at boot.

## Consequences

### Positive

✅ CI/CD runs entirely offline on the stub (deterministic, free)  
✅ Model changes are config-only — gated by an eval run  
✅ Per-attempt attempts/costs are always recorded — mini-eval measures them  
✅ Injections fail safe: flagged at L0, neutralized by DATA framing  
✅ Honest failure is unmissable: `E-AI-004`/`E-AI-005` never masquerade as success

### Negative

⚠️ Two schema toolchains remain (JSON Schema ↔ Pydantic codegen pending — Phase 2.5 deferral still applies)  
⚠️ HTTP providers are untested against live networks in CI (config + unit seam ready)  
⚠️ In-memory JobStore is lost on restart (Phase 6 persists to the ledger tables)

### Mitigations

- Mini-eval report (`evaluation/reports/phase4-mini-eval.md`) is committed as
  Phase 4 evidence and re-runs in CI on the stub.
- Provider factory refuses to build an HTTP provider without its API key
  (config error at boot, not a silent fallback).
- `REGISTRY_TYPES` (header/hero/features/cta/footer) stays in lockstep with
  `packages/ui-components` (Phase 3 drift-check covers the TS side).

---

## References

- Master prompt PART VI §6.2–6.10 (provider abstraction, repair ladder, ledger)
- Master prompt PART VIII §8.1 (L0 gate), §8.3 (validation issue shape)
- Master prompt PART IX §9.1–9.2 (golden dataset, metrics)
- Master prompt PART X §10.2 (entities: GenerationAttempt, GenerationJob)
- `docs/ai-pipeline.md` (operational walkthrough)
- ADR-0002 (canonical JSON Schema as source of truth)