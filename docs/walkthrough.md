# Walkthrough — Phase-by-Phase Implementation Log

This document records the implementation progress phase by phase, per master prompt §16.3.

---

## Phase 0 — Protocol Bootstrap

**Date:** 2026-09-09  
**Objective:** Prove the protocol was read; bootstrap the master prompt.

**Implemented:**
- Acknowledged the 12 Prime Directives by ID
- Identified first action (deep discovery) and phase-gate rule

**Created:**
- `docs/MASTER_PROMPT.md` (copy of the master prompt)

**Database:** N/A  
**API:** N/A  
**AI:** N/A  
**Frontend:** N/A  
**Tests:** N/A

**Known limitations:** None

---

## Phase 1 — Deep Discovery

**Date:** 2026-09-09  
**Objective:** Understand before touching anything.

**Implemented:**
- Full repository analysis (greenfield project)
- Technology and architecture discovery

**Created:**
- `docs/discovery-report.md` (sections A–M)
- `docs/architecture.md`

**Database:** N/A  
**API:** N/A  
**AI:** N/A  
**Frontend:** N/A  
**Tests:** N/A

**Known limitations:** Repository is empty — no existing code to analyze.

---

## Phase 2 — Page Schema Foundation

**Date:** 2026-09-09  
**Objective:** Establish the canonical Page Schema contract with validation.

**Implemented:**
- Canonical JSON Schema strategy adopted (ADR-0002)
- Monorepo structure initialized (pnpm workspaces + Turborepo)
- Document envelope + section anatomy defined
- Seed registry (header, hero, features, cta, footer)
- L1 structural validator (JSON Schema + Ajv)
- L2 semantic validator (SEM-001..004 rules)
- Migration skeleton + version policy
- Valid/invalid fixtures
- Codegen drift-check script

**Created:**
- `docs/adr/ADR-0002-canonical-schema-strategy.md`
- Root config: `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `package.json`, `.gitignore`, `.env.example`
- `packages/page-schema/schema/envelope.schema.json`
- `packages/page-schema/schema/sections/{header,hero,features,cta,footer}.schema.json`
- `packages/page-schema/src/validators/{structural,semantic}.ts`
- `packages/page-schema/src/{registry,version,index}.ts`
- `packages/page-schema/src/migrations/index.ts`
- `packages/page-schema/examples/{valid-vet-ar-001,valid-saas-en-001,invalid-no-hero,invalid-duplicate-ids}.json`
- `packages/page-schema/tests/{structural,semantic}.test.ts`
- `packages/page-schema/scripts/codegen-check.mjs`

**Database:** N/A  
**API:** N/A  
**AI:** N/A  
**Frontend:** N/A

**Tests:** 15 passing (9 semantic + 6 structural)  
**Results:** Typecheck clean; drift check passes

**Known limitations:**
- Zod/Pydantic codegen not yet wired (requires pydantic tooling — phase 2.5)
- Only 4 of 15 section types in registry (MVP scope: header, hero, features, cta, footer)
- L2 rules limited to SEM-001..004 (seed set)

---

## Phase 3 — Design System + Renderer

**Date:** 2026-09-09  
**Objective:** Tokens, theme presets, Arabic-first typography, and a deterministic schema → DOM renderer shared by preview and production.

**Implemented:**
- `@landing-ai/design-system`: design tokens, 4 theme presets, `resolveTheme()` fallback, typography with script-aware leading, RTL helpers
- `@landing-ai/ui-components`: ThemeProvider (CSS custom properties from tokens), primitives (Button/Container/SectionHeading), sections (Header/Hero/Features/Cta/Footer), component registry, deterministic `Render`er
- E-RENDER-001 safe fallback for unknown section types; per-section error boundary hook (E-RENDER-002) so one bad section never blanks the page
- Matrix tests: every seed fixture × theme preset renders identically across reruns

**Created:**
- `packages/design-system/src/{tokens,themes,typography,rtl}/*`
- `packages/design-system/tests/design-system.test.ts`
- `packages/ui-components/src/{theme,primitives,sections,registry,Renderer}.{ts,tsx}`
- `packages/ui-components/vitest.config.ts`, `tests/setup.ts`
- `packages/ui-components/tests/{sections,Renderer,matrix}.test.tsx`

**Database:** N/A  
**API:** N/A  
**AI:** N/A  
**Frontend:** `ui-components` + `design-system` (source-aliased into vite/tsc)

**Tests:** 47 total across repo (15 schema + 9 design-system + 23 ui-components) — all passing  
**Results:** Typecheck clean (all 3 packages); drift check green; features grid honors `layoutHint.columns`

**Known limitations:**
- lint not configured yet (turbo `lint` task exists; no eslint rig) — deferred to a tooling pass
- fr fixture not created; matrix currently ar/en × 4 theme presets
- Images are `asset:` references only; generation model decision deferred
- Typography: 1.8 leading for Arabic vs 1.6 for Latin (assertion fixed to compare Arabic > Latin)

---

## Phase 4 — AI Engine

**Date:** 2026-09-09  
**Objective:** Schema-driven generation service: provider abstraction, versioned prompts, structured output, repair ladder, cost ledger, honest failure, and a golden-brief mini-eval.

**Implemented:**
- `apps/ai-engine` FastAPI service (Python 3.12)
- Provider abstraction (§6.2): `StructuredLLMProvider` protocol; stub (deterministic, offline, never echoes briefs), openai/anthropic HTTP providers; config-driven routing (§6.3) in `config/routing.yaml`
- Versioned prompt assets (§6.6): stage1..stage5 YAML + `PromptStore`; canonical stage JSON Schemas in `app/schemas/` (ADR-0002)
- Repair ladder (§6.5): generate → validate → retry → targeted re-ask → deterministic safe repair → honest `E-AI-004`; provider crashes record once then `E-AI-005`
- Cost ledger (§6.9): `JobLedger` with per-attempt USD estimates, per-job attempt cap (`E-AI-003`) and budget (`E-AI-002`); credit: stages 4∥5 via `asyncio.gather`
- L0 gate (§8.1): length caps, ar/fr/en locale detection, injection flagging (brief-as-data enforcement is baked into prompts)
- Internal API: `GET /healthz` public; `POST /internal/v1/generate`, `GET /internal/v1/ledger/{job_id}`, `GET /internal/v1/prompts` behind `X-Internal-Token`
- Mini-eval (§9.1–9.2): 13 golden briefs (12 verticals × ar/fr/en + injection case), schema validity measured, Markdown report committed

**Created:**
- `apps/ai-engine/app/{api,core,prompts,providers,routing,schemas,cost,services,evaluation}/**`
- `apps/ai-engine/config/routing.yaml`, `evaluation/golden/*.json`
- `docs/ai-pipeline.md`, `docs/adr/ADR-0003-ai-engine-architecture.md`
- `apps/ai-engine/{README.md,.env.example,pyproject.toml}`

**Database:** in-memory JobStore (Phase 6: PostgreSQL ledger per PART X)
**API:** FastAPI `/healthz` + `/internal/v1/*` (internal token auth)
**AI:** staged generation pipeline with repair ladder + honest failure
**Frontend:** none this phase

**Tests:** 41 pytest (healthz/auth, generate happy path, L0/E-AI-001, budget E-AI-002, E-AI-004/E-AI-005, repair ladder via flaky/rigged/raising providers, ledger caps, prompt registry, injection, mini-eval)  
**Results:** ruff clean; mypy clean (32 modules); mini-eval validity 1.0 ≥ 0.99, 13/13 cases, injection case flagged & artifact-free

**Known limitations (resolved in Phase 5):**
- HTTP providers have no live-network test in CI (seams + config validation in place)
- In-memory job store is volatile (Phase 6)
- Stage outputs are not yet assembled into the Page Schema envelope (→ Phase 5 SchemaBuilder)

---

## Phase 5 — SchemaBuilder (stage 7) + Page Schema preview loop

**Date:** 2026-09-09  
**Objective:** Deterministic assembly of the five stage outputs into the canonical Page Schema envelope, L1+L2 page validation on every job, and a schema → DOM renderer pin (§6.12).

**Implemented:**
- `app/services/schema_builder.py`: deterministic stage 7 — ordering (layout-driven, then phase-stable header/hero/footer anchors), canonical slot mapping (content `image` → `media`), null optional CTA slots dropped, locale-derived direction/font, theme defaults within canonical enums, honest page-title derivation; assembly diagnostics `E-BUILD-001..003`
- `app/services/page_validator.py`: L1 against the CANONICAL `envelope.schema.json` (ADR-0002 single source, `AI_PAGE_SCHEMA_DIR`, `E-BUILD-004` if unavailable) + Python SEM-001..004 mirror; `page_validation = {valid, errors, warnings, issues}` rides on every completed job
- Pipeline: SchemaBuilder + validation after stages 4∥5 (stages list unchanged — 5 provider stages); `JobResult.page/page_validation/build_issues`
- API: `GET /internal/v1/pages/{job_id}` (assembled schema + validation for preview)
- Mini-eval: per-case `page_valid` + `pages_validity_rate` (target same ≥0.99); 13/13 pages valid, report `evaluation/reports/phase5-mini-eval.md`
- Renderer pin: `app/evaluation/export_fixtures.py` writes deterministic envelopes to `packages/page-schema/examples/ai-vet-ar-001.json` + `ai-saas-en-001.json`; `--check` drift guard (pytest); ui-components `tests/ai-fixture.test.tsx` (matrix × 4 themes, determinism, single h1); page-schema TS validators now assert L1+SEM on the AI fixtures

**Created:**
- `apps/ai-engine/app/services/{schema_builder,page_validator}.py`
- `apps/ai-engine/app/evaluation/export_fixtures.py`, `evaluation/reports/phase5-mini-eval.md`
- `packages/page-schema/examples/ai-*.json`, `packages/ui-components/tests/ai-fixture.test.tsx`

**Database:** still in-memory JobStore (Phase 6)
**API:** added `GET /internal/v1/pages/{job_id}`
**Frontend:** renderer pin tests only (assembled pages now render)

**Tests:** 66 pytest (SchemaBuilder assembly, SEM mirror, pipeline page, fixture drift, generate/pages endpoints) + TS 33 ui-components (incl. ai-fixture) + 19 page-schema (incl. AI fixtures)  
**Results:** ruff clean; mypy clean (35 modules); mini-eval validity 1.0 & pages_validity 1.0 ≥ 0.99, 13/13 cases, injection flagged & artifact-free; fixture export byte-deterministic (drift check green)

**Known limitations:**
- Assemble-time semantic checks mirror TS SEM-001..004 only; per-type slot typing (hero/features/…) is authoritative at render/publish via the TS validators
- Assets are `asset:` references with `assets: []` until PART VII AssetResolver (later phase)
- Still no worker/queue (Phase 5 role in the master catalog) — deferred; SchemaBuilder precedes it so orchestration can hand complete Page Schemas

---

## Phase 6 — Worker & Job Orchestration (BullMQ)

**Date:** 2026-09-09  
**Objective:** Async job tier between the API and the AI engine: `202 { jobId }` on enqueue, BullMQ worker draining the queue, engine call with retries/backoff/timeout/budget, stable lifecycle events (§11.4), idempotent create/replay, cancellation, per-job telemetry spans, and an E2E against the real engine (stub provider).

**Implemented:**
- `apps/worker` (TypeScript, fastify + BullMQ + ioredis): `jobs/{types,enqueue}`, `engine/{types,client}`, `queue/{ports,bullmq,memory}`, `processor`, `routes`, `server`, `store`, `telemetry`
- Queue port layer (ADR-0004): production = BullMQ over real Redis; tests = in-memory driver (`makeMemoryDriver`) that emulates BullMQ dedupe/backoff/exhaustion so the **real processor** runs offline. ioredis-mock cannot run BullMQ Lua (`cmsgpack`), so the whole suite was de-coupled from a live Redis.
- API (PART X §11): `POST /api/jobs` (202/200 replay, `Idempotency-Key` or derived fingerprint, `E-JOB-002` on same-key-different-payload → 422), `GET /api/jobs/:id[/events|/spans]`, `DELETE /api/jobs/:id` (cancel, 409 if terminal), `GET /healthz`
- Lifecycle: `job.queued → job.started → stage.* → job.completed | job.failed | job.cancelled`; stage events synthesized from the engine payload via a stable engine-stage→event map; `persona/layout/asset-planner` intentionally emit nothing; engine 5xx/timeout retried (exponential backoff, `E-JOB-001` on exhaustion), business/`FAILED` and malformed (`E-JOB-004`) terminal
- Idempotency: `gen_<sha256(key)[0:24]>` job id passed to the engine (echoed back), so `/internal/v1/pages/{job_id}` is reachable from the job view
- Crash recovery: interrupted `RUNNING` re-runs with `job.retried {E-JOB-005}`

**Created:**
- `apps/worker/*` (src + tests + configs + `.env.example`), `apps/worker/README.md`
- `tests/{fake-engine,harness,integration,routes,telemetry}.test.ts` (16 unit), `real-engine.integration.test.ts` (E2E, spawns uvicorn), `real-bullmq.integration.test.ts` (real Redis, self-skips)
- `docs/adr/ADR-0004-worker-orchestration.md`

**Database:** in-memory `MemoryJobStore` + `MemorySpanStore` (persistence = next phase)
**API:** worker HTTP API added (see above); engine contract unchanged
**Frontend:** N/A

**Tests:** worker `pnpm test` 16 green (lifecycle order, idempotency, retry→complete attempts=3, exhaustion E-JOB-001, business E-AI-001/005/002 no retry, malformed E-JOB-004, timeout E-JOB-001, cancel E-JOB-003 no engine call, telemetry spans); `test:integration` real-engine E2E green (real job COMPLETED, `engineJobId` echo, schemaVersion 1.0.0, `page_validation.valid`, well-formed events); real-BullMQ skipped (no Redis). Repo-wide: ai-engine 66 pytest, ruff, mypy (35) green; page-schema 19 + ui-components TS green.

**Results:** worker typecheck + build clean; full-stack flow proven: API → queue → processor → engine (real HTTP) → validated page envelope → stable events.

**Known limitations:**
- Idempotency/`E-JOB-002` guarantee is within one worker process only (in-memory store; DB phase next)
- `VALIDATING`/`RENDERING` states are reserved (engine is synchronous); post-hoc stage events, not streamed
- BullMQ-specific paths (stalled/RT-delivery) only exercised when the optional real-BullMQ test runs against local Redis
- Real-engine e2e asserts a well-formed event frame rather than a fixed stage list (engine only tracks its 5 sub-generation steps)

---

## Phase 6 (DB) — Database & Persistence (PostgreSQL + Prisma)

**Date:** 2026-09-09  
**Objective:** Durable, tenant-safe data layer per PART X §10: full entity model, forward-only migrations, integrity constraints/indexes, tenant-scoped repositories (no find-by-id without an ownership filter), optimistic concurrency on drafts, version immutability, dev seeds.

**Implemented:**
- `packages/database` (@landing-ai/database): Prisma client, repositories, seeds
- `prisma/schema.prisma` — full §10.1 model: `User ─< Project ─< Page ─< PageVersion`, `Project ─< GenerationJob ─< GenerationAttempt`, `PageVersion ──< PublishedPage >── Subdomain`, `PromptVersion`; `GenerationStatus` enum mirrors the worker `JobStatus`; audit fields (`createdAt/updatedAt/createdBy`), soft deletes (user/project/page/asset, `published_page.unpublishedAt`), append-only `publication_event`
- Migrations: `0001_init` (full model, reviewed SQL) + `0002_add_unpublished_at` (single ALTER) — forward-only (§10.3)
- Constraints: `unique(page_id, version_number)`, `@unique(idempotencyKey)` (multi-instance dedupe), `@unique(stage, version)` prompt registry, `@unique(storageRef)`, `@unique(host)`, `@unique(page_id, locale)`; FKs with CASCADE down the ownership tree, RESTRICT on version→published, SetNull on job.page_id; indexes on every ownership FK + `(project_id, status)` + `status`
- Repositories (all `Owner { userId }`-scoped, §10.5): projects, pages/versions, jobs+attempts, assets, publishing (+events, subdomains), prompt registry
- Version immutability (§10.2): versions have no update path; a new draft/save = new row; restore copies into a new version
- Optimistic concurrency (§10.2): `saveVersion({ baseVersion })` — exactly one of two concurrent saves wins
- Job state machine (§10.2) + idempotency-key dedupe at the DB layer + idempotent attempt recording per `(job, stage, attempt)`
- Seeds (`prisma/seed.ts`, PD-05 dev-only, idempotent): demo user, vet project (page from `valid-vet-ar-001.json`, published to a demo subdomain, COMPLETED job from golden `vet-ar-001.json` with an attempt row), SaaS project (queued job), 5 engine prompt YAMLs registered as `PromptVersion` with real sha256 hashes

**Created:**
- `packages/database/{package.json,tsconfig*,vitest.config.ts,.env.example,README.md}` + `prisma/{schema.prisma,migrations/*,seed.ts}`
- `src/{client,errors,owner,index}.ts`, `src/repositories/{projects,pages,jobs,assets,published,prompts}.ts`
- `tests/{global-setup,migrate,isolation,immutability,concurrency,jobs,published}.test.ts` — 24 green
- `docs/adr/ADR-0005-database-persistence.md`

**Tests:** `globalSetup` drops the schema and replays all migrations on `DATABASE_URL` (default local `landing_ai_test`); files run serially (`fileParallelism: false`). All 24 green: migrations clean + §10.2 constraints present; tenant-isolation matrix across every repository (wrong owner → `NotFoundError`, archived projects excluded); version immutability (new rows, restore = new version, stale base rejected); optimistic concurrency (exactly-one-wins, gapless sequence); job state machine + key dedupe + attempt idempotency; publish snapshot move + append-only events. Typecheck + build clean (requires `packages/page-schema` built first).

**Database:** PostgreSQL (local PG18) — `landing_ai` (dev: migrate dev + seed) and `landing_ai_test` (tests: drop schema + migrate deploy each run)
**API:** unchanged (worker `MemoryJobStore` still powers the runtime; `JobsRepository` mirrors its semantics for the Phase 7 swap)
**Frontend:** N/A

**Known limitations / next:**
- Worker persistence swap (durable JobStore with project context) lands with the web app (Phase 7) where auth exists
- Isolation is repository-level; account deletion soft-path and cross-project sharing are future work
- Production `DATABASE_URL` provisioning + password rotation are deployment-phase concerns

---
## Phase 7 - Web Application (App Router, Session+CSRF Auth, Generation UX)

**Date:** 2026-09-10
**Objective:** User-facing surface per master catalog Phase 6 role (auth, dashboard, projects, brief form, generation UX, preview) with the DB as source of truth (ADR-0005) and the worker as the async executor (ADR-0004). Acceptance J1: the happy path works e2e against the REAL engine (dev) - no fake data anywhere in the flow.

**Implemented (apps/web, Next 14.2.35 App Router + RSC):**
- Routes: `/(root)` + `(dashboard)` group, `/login`, `/register`, `/dashboard`, `/projects/[projectId]`, `/projects/[projectId]/pages/[pageId]` (preview), plus the /api/v1 API. `next build` green: full route table, all app routes dynamic (ƒ), /_not-found + /healthz static.
- Auth: scrypt password hashing (zero-dep `node:crypto`, `scrypt$N$r$p$saltB64$hashB64`, constant-time compare); named session tokens (httpOnly `sid`, 30-day TTL, DB Session row); CSRF double-submit (readable cookie + `x-csrf-token` on mutations) enforced by `requireCsrf`; `requireAuth` yields the `Owner { userId }` every repository call is scoped by (ADR-0005 §10.5 - cross-tenant reads are 404s).
- Generation UX: brief form (FR/AR/EN + tone), `POST /api/v1/generate` -> 202 + jobId; progress via polled status; honest error codes; preview served from the latest `PageVersion` through the same renderer components. No fake states: the DB only mirrors the worker.
- Orchestration (`lib/generation-service.ts`): idempotency key `doc:userId:pageId:retryNonce` (nonce = count of prior terminal FAILED+CANCELLED jobs for the page); DB job id = `gen_<sha256(key)[0:24]>` = the worker's computed id; `liveSync()` appends unseen worker events and mirrors in-flight status; `finalize()` persists an L1-validated PageVersion (COMPLETED) or records the worker's REAL error.code; `runExclusive` per-job mutex so polling never races finalize/saveVersion. Worker-loss mid-flight -> honest E-JOB-004. jsonError: 4xx keep their code, 5xx collapse to E-INTERNAL-001.
- State machine (packages/database): QUEUED now allows VALIDATING and COMPLETED - a real worker may complete before the web's first poll (fast-path arc). Terminal lock, backwards-transition rejection, and QUEUED->RENDERING illegality unchanged; the DB suite's state-machine test updated accordingly.
- Components: `components/dashboard-view.tsx`, `components/project-detail-view.tsx` are `'use client'` (styled-jsx is Server-Component-hostile); the `(dashboard)` layout and page-detail server components use one `globals.css` (inline styles everywhere, no runtime CSS imports).
- Test seams: `setGenerationServiceFactory`/`buildGenerationService()` swap the WorkerClient for (a) FakeWorkerClient in integration and (b) the real worker pipeline (fastify + processor + in-memory queue driver) wired to a spawned real ai-engine (stub provider) in the J1 e2e. Routes unchanged under both.
- E2E: starts the worker bridge PAUSED and `resume()`s after the web enqueue commits (in-memory driver drains on add(); enqueue store.put()s QUEUED after add resolves - the same race the worker harness avoids by resuming post-enqueue). Real engine spawned with `AI_PROVIDER=stub AI_INTERNAL_TOKEN=test-token AI_ENV=test`.

**Created:**
- apps/web: `app/**` (routes + forms + UI), `components/*`, `lib/{api,data,env,generation-key,generation-service,validation,worker-client}.ts`, `lib/auth/{context,csrf,password,server,session}.ts`, `app/globals.css`, `next.config.mjs` (transpilePackages), tsconfig/vitest configs
- apps/web/tests: `harness.ts` (FakeWorkerClient, samplePageSchema, makeApiClient with auto-CSRF/session cookies), `global-setup.ts` (drop schema + replay migrations via `@landing-ai/database` `createPrismaClient`), unit tests (password 5, csrf 5, generation-key 9 = 19), `api.integration.test.ts` (13, DB-backed), `j1-e2e.e2e.ts` (3, REAL engine + worker), `e2e/worker-bridge.ts`
- docs/adr/ADR-0006-web-application.md, docs/api-reference.md
- Root `.env.example` now documents `WORKER_URL` (web -> worker API, default http://localhost:8080)

**Tests:**
- web unit: 19 green (password scrypt format + constant-time, CSRF cookie/header parity + 403s, generation-key derivation/idempotency/uniqueness).
- web integration: 13 green on real Postgres (`landing_ai_test` replayed each run). Aligned `versionNumber` assertions to the repo convention (first draft = v1).
- J1 e2e: 3 green - auth -> project -> page -> generate -> real engine -> L1-validated PageVersion persisted -> API preview serves it; replay returns 200 with the same jobId. Skipped when `apps/ai-engine/.venv` is absent.
- database: 29 green (state-machine fast-path added; typecheck + build clean). worker: 16 green, typecheck clean (untouched).
- Full regression: web typecheck + `next build` + unit + integration + e2e all green; database build/test green.

**Database:** PostgreSQL - `landing_ai` (dev) and `landing_ai_test` (tests, schema replayed per run). One schema change: QUEUED->{VALIDATING, COMPLETED} fast-path arcs (migration-less; pure repository transition map).
**API:** web /api/v1 (auth, projects, pages, generate, generation-jobs, pages preview, healthz) - see docs/api-reference.md. Worker API unchanged (§11).
**Frontend:** App Router with RSC; dashboard, project detail (brief form + job status), page preview; inline styles via globals.css; no runtime CSS framework.

**Known limitations / next:**
- Publication flows, editor UX, and XSS-safe server rendering of versions are Phase 8+.
- Web honesty: if the worker is down, enqueue fails and the DB records the real code; a job whose worker lost it fails E-JOB-004 - never a fake completion.
- Production ops still to land: secrets, TLS, rate limiting, S3-backed assets, optional real Redis/BullMQ validation, session rotation.
- The e2e requires the ai-engine venv (skips cleanly otherwise); real-engine costs in CI would need an engine fixture or stub-only mode.

---

## Phase 8 — Editor (Schema-Level Editing, Regeneration, Validated Drafts)

**Date:** 2026-09-10  
**Objective:** Turn generated pages into editable drafts: tune text/images/theme/order, re-roll individual sections through the real engine pipeline, and persist every change as a new immutable, L1-validated version — never a corrupted schema.

**Implemented (apps/web + worker + engine):**
- `components/editor/` (`'use client'`): `editor-utils.ts` (cloning/draft/JSON-path ops, slot type labels), `content-editor.tsx` (generic recursive JSON editor: text/number/boolean, array add-remove-reorder, `assetRef` objects with a stock-image browser + URL/alt), `theme-picker.tsx` (`GET /api/v1/themes` → swatch picker applying `{preset, font, primaryColor, radius, density}`), `page-editor.tsx` (theme panel + section list with select/↑↓/↻ and regen status, inspector with L1 issues + L2 warnings, `PagePreview` of the *draft* via the same renderer as production, save-vs-discard). The server page mounts `<PageEditor key={'v'+versionNumber} …>` so both SAVE and regen-completion `router.refresh()` into a fresh editor for the new version.
- Routes: `POST /api/v1/pages/:id/versions` (200 new version; 409 E-CONFLICT stale base → reload; 422 E-VAL-L1 with `details.issues`; never persists an invalid envelope), `GET /api/v1/themes`, `GET /api/v1/assets`, `POST /api/v1/pages/:id/regenerate` (`{versionNumber, targetSectionId, mode:'section'}` → 202 + jobId).
- **Section regeneration:** a normal worker `generation-jobs` row. On COMPLETED a new L1-validated version is persisted whose non-target sections are **byte-identical** to the version being edited; engine/validation failures leave the target version intact (no half-edited pages, ever).
- Worker: permanent real-engine section-regen integration test (full gen → hero regen → byte-stable untouched sections, valid L1, ids preserved).

**Fixed (Phase 8):**
- The "hanging" RegenerateJob root cause: `apps/worker/src/jobs/enqueue.ts` put the store record AFTER `queue.add()`; the in-memory driver's synchronous `drain()` inside `add()` started the processor, whose RUNNING/COMPLETED writes were then clobbered by the QUEUED put. Fix: put before add + `E-JOB-001` FAILED guard on add failure.
- Debug instrumentation (PROCDBG/MEMDBG/logging) added while chasing the race — removed.
- J3 test fixes: real theme envelope shape (`preset` top-level, not inside `theme`) and first-draft-is-v1.

**Created:**
- `docs/adr/ADR-0007-section-regeneration-and-editing.md`
- `apps/web/components/editor/*` (4 files), updated `app/(dashboard)/projects/[projectId]/pages/[pageId]/page.tsx`, `app/globals.css` (`.editor-section`)
- docs/api-reference.md (themes/assets/versions/regenerate), this file, CHANGELOG.txt, NOTES.txt

**Tests:**
- worker: 18 unit + 2 integration (real engine: full pipeline **and** section regen) + 2 skipped (real-BullMQ, no Redis).
- web: 19 unit + 25 integration (includes J2 e2e + new themes/assets/versions/regenerate suites).
- database 30, page-schema 22 (dist rebuilt), engine 72 pytest — all green.
- web typecheck clean; `next build` compiled successfully.

**Frontend:** `'use client'` PageEditor wired into the page-detail server route; drafts render through the same ui-components renderer used in production preview.

**Known limitations / next:**
- Regenerating discards unsaved local edits (editor remounts on the new version); dirty-merge reconciliation is future work.
- No component tests for the editor (no jsdom/testing-library rig); verified by typecheck + next build + API/e2e suites.
- L2 rules stay advisory (warnings); text slots are plain inputs, not a rich text editor.
- Remaining: subdomain publication, XSS-safe server rendering of versions, production ops (secrets/TLS/rate limit/S3-backed assets, optional real Redis/BullMQ validation).
