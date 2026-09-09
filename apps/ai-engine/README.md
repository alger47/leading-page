# AI Engine — schema-driven landing page generation service

FastAPI service that turns a plain-language business brief into a **validated
Page Schema document** — Arabic-first (ar/fr/en), per the master prompt PART VI.
Stages 1–5 (analysis → plan → layout → content → asset requirements) are
LLM-driven with a repair ladder; a deterministic **SchemaBuilder** (stage 7)
merges their outputs into the canonical envelope and L1+SEM validation rides on
every job. Phase 6 adds persistence of the ledger/jobs.

## Layout

```
apps/ai-engine/
├── app/
│   ├── api/            # FastAPI routes + internal-auth DI container
│   ├── core/           # brief validation (L0), error codes, schema store
│   ├── prompts/        # versioned prompt assets (stage1..stage5 YAML)
│   ├── providers/      # structured-output providers (stub / openai / anthropic)
│   ├── routing/        # config-driven model routing (PART VI §6.3)
│   ├── schemas/        # canonical stage JSON Schemas (ADR-0002)
│   ├── cost/           # per-attempt ledger + job budget/attempt caps
│   ├── services/       # stage runner (repair ladder), pipeline, schema_builder,
│   │                   # page_validator (L1 canonical envelope + SEM mirror)
│   └── evaluation/     # mini-eval on golden briefs + fixture export
├── config/routing.yaml # model classes, costs, per-stage prompts/fallbacks
├── evaluation/         # golden briefs + reports
└── tests/
```

## Quick start

```powershell
cd apps\ai-engine
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e .
Copy-Item .env.example .env
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
```

## Endpoints

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /healthz` | public | liveness + readiness (schema/prompt/stage counts) |
| `POST /internal/v1/generate` | `X-Internal-Token` | run the pipeline on a brief → job + assembled Page Schema |
| `GET /internal/v1/ledger/{job_id}` | `X-Internal-Token` | job report incl. per-stage attempts/cost |
| `GET /internal/v1/pages/{job_id}` | `X-Internal-Token` | assembled Page Schema + page_validation (preview input) |
| `GET /internal/v1/prompts` | `X-Internal-Token` | registered prompt assets |

## Quality gates

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\ruff.exe check .
.\.venv\Scripts\python.exe -m mypy app
.\.venv\Scripts\python.exe -m app.evaluation.mini_eval   # golden-brief acceptance
.\.venv\Scripts\python.exe -m app.evaluation.export_fixtures --check  # renderer fixtures drift
```

Mini-eval target: schema **validity ≥ 0.99** on ≥10 golden briefs AND assembled
**page validity ≥ 0.99** (canonical L1 + SEM). Every job records per-stage
attempts and costs; prompt-injection briefs are handled as data. See
`docs/ai-pipeline.md` and `docs/adr/ADR-0003-ai-engine-architecture.md`.

The canonical Page Schema is read from `AI_PAGE_SCHEMA_DIR` (default
`packages/page-schema/schema` in the monorepo — the ADR-0002 single source;
never vendored).

## Error codes

| Code | Meaning |
| --- | --- |
| `E-AI-001` | L0 brief validation failed |
| `E-AI-002` | per-job cost budget exceeded |
| `E-AI-003` | per-job attempt budget exceeded |
| `E-AI-004` | stage exhausted its repair ladder — job fails honestly |
| `E-AI-005` | provider hard error (no thrashy retries) |
| `E-AI-006` | unknown stage / invalid routing configuration |

SchemaBuilder diagnostics (non-fatal — the page still renders honestly):

| Code | Meaning |
| --- | --- |
| `E-BUILD-001` | stage slot dropped/mapped (content anomaly) |
| `E-BUILD-002` | planned section has no generated content (omitted) |
| `E-BUILD-003` | page title derived via fallback |
| `E-BUILD-004` | canonical envelope schema unavailable (page_validation records it) |