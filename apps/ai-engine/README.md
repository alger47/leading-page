# AI Engine — schema-driven landing page generation service

FastAPI service that turns a plain-language business brief into a structured
landing page plan, layout, content and asset requirements — Arabic-first
(ar/fr/en), per the master prompt PART VI. It is the **Stage engine** of the
pipeline; **Phase 5 will assemble these outputs into a Page Schema** and Phase 6
adds persistence.

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
│   ├── services/       # stage runner (repair ladder), pipeline, validators
│   └── evaluation/     # mini-eval on golden briefs
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
| `POST /internal/v1/generate` | `X-Internal-Token` | run the pipeline on a brief |
| `GET /internal/v1/ledger/{job_id}` | `X-Internal-Token` | job report incl. per-stage attempts/cost |
| `GET /internal/v1/prompts` | `X-Internal-Token` | registered prompt assets |

## Quality gates

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\ruff.exe check .
.\.venv\Scripts\python.exe -m mypy app
.\.venv\Scripts\python.exe -m app.evaluation.mini_eval   # golden-brief acceptance
```

Mini-eval target: schema **validity ≥ 0.99** on ≥10 golden briefs; every job
records per-stage attempts and costs; prompt-injection briefs are handled as
data. See `docs/ai-pipeline.md` and `docs/adr/ADR-0003-ai-engine-architecture.md`.

## Error codes

| Code | Meaning |
| --- | --- |
| `E-AI-001` | L0 brief validation failed |
| `E-AI-002` | per-job cost budget exceeded |
| `E-AI-003` | per-job attempt budget exceeded |
| `E-AI-004` | stage exhausted its repair ladder — job fails honestly |
| `E-AI-005` | provider hard error (no thrashy retries) |
| `E-AI-006` | unknown stage / invalid routing configuration |