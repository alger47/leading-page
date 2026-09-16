# Architecture Roadmap — Landing AI Studio Baseline

**Created:** 2026-09-16  
**Purpose:** Record the current working state, map the recommended target architecture to what already exists, define how every future modification is logged, and guarantee a rollback point.

---

## 1. Rollback Point (SAFE BASELINE)

| Item | Value |
|------|-------|
| Git tag | **`baseline-2026-09-16`** (annotated) |
| Commit | `f5a0ae076298f4ef1c946afb5f13f58d04cf42c5` |
| Branch | `master` (local) / `origin/main` (remote) |
| Status at snapshot | Working tree clean except `apps/web/tsconfig.tsbuildinfo` (build artifact, regenerated on build) |
| Verified working | AI engine pytest/ruff/mypy + mini-eval, worker tests, web unit/integration/e2e, DB tests, `next build`, publish budget 79.5 KB gz |

**How to return to this state (rollback):**

```powershell
git -C "F:\PRATIQUE\LEADING PAGE" checkout baseline-2026-09-16
# or discard all uncommitted work and reset to the baseline:
git -C "F:\PRATIQUE\LEADING PAGE" reset --hard baseline-2026-09-16
```

`baseline-2026-09-16` is immutable. Never move or delete this tag.

---

## 2. Recommended Architecture × Current Implementation

Status legend: ✅ implemented · ⚠️ partially implemented · ❌ not started

### 1. البنية (Next.js Web + Worker + AI Engine + PostgreSQL + Redis)
✅ **Implemented.** Turborepo monorepo (`pnpm-workspace.yaml`, `turbo.json`):
- `apps/web` — Next.js + TypeScript (App Router)
- `apps/worker` — Fastify + BullMQ job orchestration over Redis
- `apps/ai-engine` — FastAPI (Python 3.12) independent from the UI
- `packages/database` — Prisma + PostgreSQL
- LLMs run externally (OpenAI/Anthropic/Groq), never on the VPS

### 2. فصل عملية التوليد
✅ **Implemented.** `User → Next.js API → BullMQ queue → Worker → AI Engine → validation → page`:
- `apps/web/lib/generation-service.ts` (idempotency key, liveSync, finalize)
- `apps/worker/src/` (queue ports: `src/queue/{ports,bullmq,memory}.ts`, processors)
- `apps/ai-engine` HTTP API behind `X-Internal-Token`
- Async rule enforced: generation/regeneration/publishing are jobs, never inline HTTP

### 3. مشكلة E-AI-004 (repair ladder, مرات محدودة)
✅ **Implemented.**
- `apps/ai-engine/app/services/stage_runner.py` — attempt loop with max_attempts per route
- `apps/ai-engine/app/services/repair.py` — deterministic safe repairs only (never invents)
- `apps/ai-engine/app/services/fallbacks.py` — honest stage fallbacks, marked draft
- Error codes `E-AI-004` (still invalid after ladder) / `E-AI-005` (provider crash, one attempt)
- Every attempt recorded with tokens, cost, outcome in `app/cost/ledger.py` (E-AI-002 budget, E-AI-003 attempt cap)

### 4. فصل المحتوى عن الكود
✅ **Implemented.** `Brief → 5 structured stages → deterministic SchemaBuilder → canonical Page Schema`:
- Stage JSON Schemas: `apps/ai-engine/app/schemas/*.json`
- SchemaBuilder (deterministic code, never LLM free-typed): `apps/ai-engine/app/services/schema_builder.py`
- Canonical contract: `packages/page-schema/schema/envelope.schema.json`
- Renderer (data-only): `packages/ui-components` → `Renderer.tsx`

### 5. نظام Skills
❌ **Not started.** No `skills/` hierarchy exists. The engine has stages + versioned prompts instead.
- Existing seeds: `apps/ai-engine/app/prompts/` (stage1..5 YAML) + registry
- If a skills system is added, it should map skills → existing stages/prompts, not replace them.
- **First candidate gap to implement.**

### 6. LLM Gateway
⚠️ **Partially implemented.** `StructuredLLMProvider` protocol with a provider factory:
- `apps/ai-engine/app/providers/{protocol,factory,stub,stub_data,http_providers}.py`
- Real providers: **OpenAI, Anthropic, Groq** (`http_providers.py` + Groq routing config `config/routing*.yaml`)
- Missing from the recommendation list: Gemini, Qwen, local/open-source chat-completions provider.

### 7. قاعدة بيانات (تاريخ التوليد)
⚠️ **Partially implemented.**
- ✅ Full persistence layer: `packages/database/prisma/schema.prisma` — User/Project/Page/PageVersion, GenerationJob/GenerationAttempt, PublishedPage, Asset, PromptVersion, Session
- ✅ Tenant-scoped repositories (`src/repositories/*`), forward-only migrations, seeds
- ⚠️ Engine-side `JobLedger` is **in-memory** (500-job ring buffer) — per-attempt tokens/cost/errors/repairs are not yet written to `GenerationAttempt` rows. Persisting the ledger is a candidate next phase.

### 8. الأمان
⚠️ **Partially implemented.**
- ✅ Secrets via `.env`/ Render envVars, never in git (`.gitignore` blocks `*.env*`, `مفتاح*.txt`)
- ✅ Sessions: scrypt hashing, httpOnly `sid` cookie, CSRF double-submit; tenant scoping on every repo (cross-tenant = 404)
- ✅ Internal service token (HMAC constant-time compare worker ↔ engine)
- ⚠️ Missing: rate limiting, HTTPS config (Render supplies TLS), uploaded-file validation, sandboxing of generated code, automated PostgreSQL backups

### 9. المراقبة
⚠️ **Partially implemented.**
- ✅ Worker events + spans; engine cost/attempt ledger; mini-eval metrics (`apps/ai-engine/app/evaluation/`); publish budget script
- ⚠️ `packages/telemetry` is an **empty placeholder** (no package.json yet). Metrics catalog defined in `docs/architecture.md` §12 but not emitted anywhere (generation duration, tokens, model cost, failure/repair rates, queue length).

---

## 3. Known Gaps — Candidate Next Steps (one at a time, each logged)

| Priority | Gap | Recommended change |
|---|---|---|
| 1 | `packages/telemetry` empty | Implement telemetry package (logs + metrics + cost per generation) or remove placeholder |
| 2 | Engine ledger in-memory | Persist per-attempt ledger to `GenerationAttempt` (tokens, cost, errors, repairs) |
| 3 | LLM Gateway providers | Add Gemini / Qwen / local (OpenAI-compatible) providers behind `factory.py` |
| 4 | Skills system | Add `skills/` taxonomy mapping to existing prompts/stages (no new agents) |
| 5 | Production ops | Rate limiting, HTTPS headers, S3 assets, real Redis validation, PostgreSQL backups |

---

## 4. Modification Log Convention (GOING FORWARD)

**Every modification** to this project MUST be recorded in three places before it is considered done:

1. **`CHANGELOG.txt`** — a dated section headed `### <change-name> (YYYY-MM-DD)` with Implemented / Fixed / Status, mirroring the existing Phase 0–11 style.
2. **This file (`docs/architecture-roadmap.md`)** — update the status table row(s) affected by the change.
3. **A git commit** (only when asked), with a message that references the feature and any error codes touched (e.g. `fix(ai-engine): persist ledger ...`).

**Safety rule:** each implemented change must preserve the baseline guarantees: repo-wide green tests (`pnpm test`, engine pytest/ruff/mypy, `next build`) before and after. If a change cannot be completed cleanly, it is reverted and the tag `baseline-2026-09-16` restores the working state.

---

## 5. How to Verify the Project Still Works (baseline checks)

```powershell
# AI Engine
cd apps\ai-engine
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\ruff.exe check .
.\.venv\Scripts\python.exe -m mypy app
.\.venv\Scripts\python.exe -m app.evaluation.mini_eval
.\.venv\Scripts\python.exe -m app.evaluation.export_fixtures --check

# Monorepo TS packages
pnpm test
pnpm typecheck
pnpm build
```