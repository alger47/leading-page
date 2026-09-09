# AI Engine — Pipeline Walkthrough (Phase 4)

The engine turns a `brief` into five structured stage outputs. Stages 1→2→3 are
sequential; stages 4∥5 (ContentGenerator ∥ AssetPlanner) run in parallel
(master prompt §6.10). Final Page Schema assembly from these outputs is
Phase 5 (SchemaBuilder is deterministic code, never free-typed by an LLM).

## 1. L0 gate (§8.1) — before any LLM call

`brief_validation.validate_brief(brief, max_length=4000)`:

- empty / over-length brief → `E-AI-001` (recording optional for a job id)
- locale detection: `ar` (Arabic script) → `fr` (accent + function-word
  heuristic) → `en`
- injection detection: instruction-shaped phrasing (`ignore ... instructions`,
  `you are now`, `system prompt:`, `<system>`, `set ... instead`, …) is
  **flagged**, never rewritten. The brief stays data; enforcement lives in the
  DATA framing baked into every prompt template.

A job id is minted and `brief_flags` recorded. `E-AI-002/003` are the only
other early exits (attempt/budget caps), both raised by `JobLedger`.

## 2. Stage runner (PIPELINE per stage) — the repair ladder (§6.5)

For each stage: `Scheme of route` = `{prompt, max_attempts, temperature,
fallbacks}` from `config/routing.yaml`; output schema from
`schema_store.load_by_stage(stage)` (ADR-0002 canonical JSON Schema).

```
for attempt in 1..max_attempts:
    ledger.check_before_next()                      # E-AI-003 if over cap
    provider = pick(route, primary, last attempt)   # fallback class only after
                                                    # a hard provider error
    res = provider.generate_structured(schema, prompt, inputs, params, feedback)
    record attempt (tokens → cost, latency, outcome) → ledger
    if res.outcome != ok: feedback = failure; continue
    issues, valid = validate_stage_output(stage, data, schema, context)
    if valid: return success
still invalid → targeted re-ask (only failing slots)
still invalid → local safe repair (deterministic only: required-string
               placeholders, numeric clamps)         # repair.py never invents
still invalid → stage fallback data                  # clearly marked draft
               → job FAILED with E-AI-004            # honest, never fake
provider raises                                      # E-AI-005: one attempt
               recorded, then job FAILED             # no thrash loop
```

Validation issues use the stable shape of §8.3:
`{layer, ruleId, severity, path, message, fixable, stage}` — the same shape the
mini-eval consumes, so the repair path and the acceptance report measure one
truth. Stage semantic rules in Phase 4: `SEM-001..004` (hero first/exactly one,
≥1 CTA, footer last, hero.title slot), `SEM-002/003/007`
(layout covers plan exactly, no dupes; content matches plan exactly; hrefs are
anchors only). HTML/`javascript:`/event-handler text is a hard error.

## 3. Pipeline (`Pipeline.run`)

```
validate_brief → Id → ledger → brief-analyzer → page-planner → layout-planner
                → asyncio.gather(content-generator, asset-planner)
                → status COMPLETED | FAILED (+error_code | error_message)
```

`JobResult.to_dict()` returns stages, per-attempt ledger detail, validation
counts, and a merged `data` map (stage name → output) for Phase 5's
SchemaBuilder.

## 4. Providers (§6.2)

`StructuredLLMProvider` protocol — `generate_structured(*, schema, prompt,
inputs, params, feedback) -> ProviderResult(outcome, data, usage, model,
latency_ms)`. `outcome ∈ {ok, malformed, refused, timeout, provider_error}`.

- **stub** (default, `config/routing.yaml: provider: stub`): deterministic,
  offline, cost = tiny configured rates. Never echoes brief text →
  anti-hallucination and injection artifacts are structurally impossible.
- **openai / anthropic**: HTTP, JSON-schema / tool-calling structured output.
  Built only when the matching `AI_*_API_KEY` is set (else boot error).

`ProviderRegistry.force_for_tests(model_class, provider)` lets tests pin
flaky/rigged/raising doubles per model class.

## 5. Ledger & cost (§6.9)

`estimate_cost_usd = (in_tokens/1k · cost_1k_in) + (out_tokens/1k · cost_1k_out)`
per model class. `JobLedger` enforces per-job attempt cap (`E-AI-003`) and
budget (`E-AI-002`, default 0.25 USD, overridable per request). In memory for
Phase 4; persisted in Phase 6 (PART X §10.2 entities).

## 6. HTTP API

| Route | Auth | Body / notes |
| --- | --- | --- |
| `GET /healthz` | — | schema/prompt/stage counts (ready) |
| `POST /internal/v1/generate` | `X-Internal-Token` (HMAC-constant-time) | `{brief, locale?, tone?, job_id?, budget_usd?}` |
| `GET /internal/v1/ledger/{job_id}` | token | in-memory job report (500 jobs ring buffer) |
| `GET /internal/v1/prompts` | token | registered prompt refs |

422 → `E-AI-001` L0 rejection (machine-readable `detail.code`); all other
states are returned in the `job` envelope with `status: COMPLETED|FAILED`.

## 7. Mini-eval (§9.1–9.2) — Phase 4 acceptance

`python -m app.evaluation.mini_eval` runs 13 golden briefs (12 verticals
× {ar, fr, en} distribution + 1 prompt-injection case) through the full
pipeline on the stub and writes
`evaluation/reports/phase4-mini-eval.md`.

- metric: schema validity rate = valid generation attempts / attempts;
  target **≥ 0.99**; first-attempt OK rate tracked;
- per-stage attempts + costs recorded (≥10 cases, then on every job);
- injection case asserts output is artifact-free and `brief_flags` marks it.

Exit code 0 only when validity meets target (CI-enforceable).

## Run

```powershell
cd apps\ai-engine
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\ruff.exe check .
.\.venv\Scripts\python.exe -m mypy app
.\.venv\Scripts\python.exe -m app.evaluation.mini_eval
```

See ADR-0003 for the architecture decisions behind this layout.