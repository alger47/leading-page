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
- Local dev without Redis: `REDIS_URL=memory://` boots the worker on the in-memory driver (`src/queue/memory.ts`, `startPaused: false`; real handler + retries + `finalizeFailure`) — added 2026-09-16; BullMQ/Redis path unchanged. Verified live E2E (register→login→project→page→generate→COMPLETED, engine stub :8000).
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
✅ **Implemented (GAP-5, 2026-09-16).** `apps/ai-engine/app/skills/` — a read-only taxonomy over the existing primitives (never replaces stages/agents):
- `taxonomy.yaml` — 8 skills (landing-page-production covering all 5 stages, brief-analysis, page-structuring, layout-design, copywriting, asset-planning, localization, brand-tone), each mapping to `stages:` + versioned prompt assets.
- `app/skills/registry.py` — `SkillsRegistry` validates at startup that every skill id is unique, every stage ref is canonical (`CANONICAL_STAGES` = the shipped routing stage vocabulary) and every prompt ref exists in `PromptStore` (else `RoutingConfigError`); indexes stages → skills.
- Wired into the DI container (`Container.skills`) + surfaced at `GET /internal/v1/skills` (internal-token auth, same pattern as `/internal/v1/prompts`).
- Tests: `tests/test_skills.py` (9) — resolution invariants (every stage + prompt covered by the production skill), stage↔skill index, invalid-stage/invalid-prompt load errors, endpoint auth + payload shape.

### 6. LLM Gateway
✅ **Implemented (GAP-4, 2026-09-16).** `apps/ai-engine/app/providers/http_providers.py` now ships the full recommendation set behind `factory.py`:
- **OpenAI / Groq / Anthropic / Ollama** (existing) + **`GeminiProvider`** (generateContent, `responseMimeType: application/json`, usage from `usageMetadata`, refused on 400/401/403/429, malformed on non-object output), **`QwenProvider`** and **`LocalCompatibleProvider`** (OpenAI-compatible chat-completions, `json_object`, keyless-local option, 900s timeout).
- `app/config.py` +6 settings (`gemini_*`, `qwen_*`, `local_*`); `factory.py` requires keys for gemini/qwen (else `RoutingConfigError`), local is keyless; routing docs updated (`stub | openai | anthropic | ollama | gemini | qwen | local`).
- Tests: `tests/test_providers.py` 20/20 (builds, key-requirements, gemini parse/usage/malformed, qwen/local json_object) + fixed a stale openai json_schema test to match `_is_strict_compatible` fallback (open schema → `json_object`, closed schema → `json_schema` strict).

### 7. قاعدة بيانات (تاريخ التوليد)
✅ **Implemented.**
- ✅ Full persistence layer: `packages/database/prisma/schema.prisma` — User/Project/Page/PageVersion, GenerationJob/GenerationAttempt, PublishedPage, Asset, PromptVersion, Session
- ✅ Tenant-scoped repositories (`src/repositories/*`), forward-only migrations, seeds
- ✅ Engine `JobLedger` now persisted (GAP-2, 2026-09-16): `apps/web/lib/generation-attempts.ts` maps `result.ledger.attempts_detail` (outcome `ok/malformed/refused/timeout/provider_error` → `SUCCESS/FAILED/TIMED_OUT`) into `GenerationAttempt` rows via `JobsRepository.recordAttempt` (upsert per `(jobId, stage, attempt)`, idempotent) during `GenerationService.finalize` — best-effort, never blocks the finalize. Verified by unit test (mapper, 5) + API integration test (real rows persisted on COMPLETED, incl. `TIMED_OUT` + `validationJson`).

### 8. الأمان
✅ **Implemented (GAP-6, 2026-09-16).**
- ✅ Secrets via `.env`/ Render envVars, never in git (`.gitignore` blocks `*.env*`, `مفتاح*.txt`)
- ✅ Sessions: scrypt hashing, httpOnly `sid` cookie, CSRF double-submit; tenant scoping on every repo (cross-tenant = 404)
- ✅ Internal service token (HMAC constant-time compare worker ↔ engine)
- ✅ Security headers shipped by `next.config.mjs` for every response (CSP `'self'`-locked, `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`); HTTPS/TLS is provided by the Render edge
- ✅ **Rate limiting** (new): token-bucket per-IP middleware on `/api/v1/*` (`apps/web/middleware.ts` + `lib/rate-limit.ts`, env `RATE_LIMIT_CAPACITY`/`REFILL_PER_SECOND`/`DISABLED`, 429 + `Retry-After` + `X-RateLimit-*`); unit tests 8
- ✅ **S3 assets** (new): `apps/web/lib/storage.ts` — `AssetStorage` contract with a local FS driver (served at `/assets/storage/{key}`, traversal-safe) and an S3 driver using dependency-free AWS SigV4 (header-signed put/get/delete + presigned GET URLs, S3-compatible endpoints via `ASSET_S3_ENDPOINT`); unit tests 10
- ✅ **Real Redis validation** (already present, verified 2026-09-16): worker pings Redis at boot (`apps/worker/src/index.ts:55`), exits(1) with actionable message on failure, or runs memory-mode via `REDIS_URL=memory://`
- ✅ **PostgreSQL backups** (new): `packages/database/scripts/backup.ts` (`pnpm --filter @landing-ai/database backup` / `backup:dry-run`) — pg_dump custom-format into `backups/` + retention pruning (`BACKUP_RETENTION`, default 7); unit tests 10; `packages/database/backups/` gitignored
- ⚠️ Still future work: uploaded-file validation & sandboxing of generated code (nothing generates executable code today)

### 9. المراقبة
✅ **Mostly implemented (GAP-1 + GAP-3 done).**
- ✅ Worker events + spans; engine cost/attempt ledger; mini-eval metrics (`apps/ai-engine/app/evaluation/`); publish budget script
- ✅ `packages/telemetry` (GAP-1, 2026-09-16): structured logger + MemorySpanStore + InMemoryMetrics (full §12 metric catalog)
- ✅ **Consumed by the worker (GAP-3, 2026-09-16):** `apps/worker/src/telemetry.ts` is now a facade re-exporting `@landing-ai/telemetry` (logger/spans/trace) — no local duplicate implementation; worker wired as workspace dep; 19/19 worker tests green.

---

## 3. Known Gaps — Candidate Next Steps (one at a time, each logged)

| Priority | Gap | Recommended change |
|---|---|---|
| 1 | ~~`packages/telemetry` empty~~ | ✅ Implemented (GAP-1): `src/{logger,spans,metrics,types}.ts` + 13 tests; full §12 metric catalog. **Consumed (GAP-3):** worker `telemetry.ts` facade re-exports `@landing-ai/telemetry`; worker tests 19/19 green. |
| 2 | ~~Engine ledger in-memory~~ | ✅ Implemented (GAP-2): `apps/web/lib/generation-attempts.ts` + `GenerationService.persistAttempts` in `finalize()` → `GenerationAttempt` rows (upsert per (jobId, stage, attempt)); unit + API integration tests green + verified live in DB. |
| 3 | ~~LLM Gateway providers~~ | ✅ Implemented (GAP-4): `GeminiProvider`, `QwenProvider`, `LocalCompatibleProvider` in `app/providers/http_providers.py` + factory branches + settings + routing comments; provider tests 20/20 (`tests/test_providers.py`), full engine pytest 148 green. |
| 4 | ~~Skills system~~ | ✅ Implemented (GAP-5): `app/skills/taxonomy.yaml` + `registry.py` (validated at startup: unique ids, canonical stages, existing prompts) + `GET /internal/v1/skills`; wired in DI container; 9 tests. |
| 5 | ~~Production ops~~ | ✅ Implemented (GAP-6): per-IP token-bucket rate limiting middleware on `/api/v1/*`; HTTPS/security headers (pre-existing `next.config.mjs` headers, CE); `lib/storage.ts` S3/local storage with dependency-free SigV4 + presigned URLs; Redis boot validation (pre-existing, verified); `packages/database/scripts/backup.ts` pg_dump + retention; 28 new unit tests across web+db. |

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