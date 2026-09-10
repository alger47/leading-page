# ADR-0006: Web Application — App Router, Session+CSRF Auth, Honest Generation UX

- **Status:** Accepted (2026-09-10, web application phase)
- **Relates to:** PART X §10 (job state machine, tenant-scoped repositories), §11 (API contract: idempotency, status/events), ADR-0004 (worker orchestration), ADR-0005 (database + persistence), master catalog "Phase 6 role: Web application + auth + UX"

## Context

The platform's user-facing surface arrives in this phase: registration/login,
a project workspace, page creation, and a one-click "generate my landing page"
flow that renders the result for preview. The architectural anchors are set:

1. **The database is the source of truth** (ADR-0005): `GenerationJob` rows in
   Postgres; the worker is an async *executor* behind the §11 HTTP API.
2. **The worker states the truth about execution** (ADR-0004): the web must
   never invent job states — it mirrors the worker and persists only what the
   worker reports.
3. **J1 acceptance requires the happy path against the real engine (dev)**,
   with no fake data anywhere in the final flow.

Constraints found while building it:

1. **`QUEUED -> COMPLETED` was a legal fast path, not an error.** The real
   engine completes in milliseconds (stub provider), so the worker reports
   `COMPLETED` before the web's *first* poll. ADR-0005's transition map did
   not allow that arc, so the first `liveSync` finalize threw (silently
   swallowed), the job stayed `QUEUED`, and — worse — each poll re-ran
   `saveVersion`, persisting duplicate versions. Fix: `QUEUED` now also allows
   `VALIDATING` and `COMPLETED` (still a strict, guarded state machine:
   terminal lock unchanged, `QUEUED -> RENDERING` still rejected).
2. **`styled-jsx` is Server-Component-hostile in Next 14 App Router.** The two
   presentational views became `'use client'` components; the server
   `(dashboard)` layout and page-detail server components moved all styles to
   one `globals.css`, so every page still ships inline styles, default fonts,
   no external CSS at runtime.
3. **Workspace packages must be consumed as built `dist`.** Next/webpack cannot
   map a package's `src/index.ts` to the emitted JS, so `apps/web` imports
   `@landing-ai/*` through `node_modules` dist (tsconfig has only `@/*` → the
   app's own files). Vitest (vite) *can* map `.js`→`.ts`, so both vitest
   configs alias workspace packages to their `src` entry for speed of truth.
   A stale `.next` cache after a tsconfig change produced a confusing
   "cannot resolve" — cleared, never resolved in code.
4. **The fast worker made the integration test's job transition invisible**:
   tests must exercise an honest mirror, so the generation e2e starts the real
   worker pipeline paused and resumes *after* the web enqueue commits — this
   also sidesteps the in-memory driver's add/store write race, exactly as the
   worker harness does.

## Decision

**A thin App Router over server-side repositories, a `GenerationService` that
mirrors the worker into Postgres, real session+CSRF security, and an e2e that
runs the actual engine and worker.**

- **Auth (`apps/web`):** named-session tokens — a secure-random token stored
  httpOnly (`sid`, 30-day TTL) with a DB `Session` row; **CSRF double-submit**
  — a second, readable cookie + `x-csrf-token` header on every mutation
  (`requireCsrf`). Passwords: zero-dep `node:crypto` scrypt, stored
  `scrypt$N$r$p$saltB64$hashB64` with constant-time compare. `requireAuth`
  resolves the `Owner { userId }` that every repository call is scoped by
  (ADR-0005 §10.5) — cross-tenant reads surface as 404s.
- **Orchestration (`lib/generation-service.ts`):** `start()` derives the
  idempotency key (`doc:userId:pageId:retryNonce`, §11.1), creates/atomically
  dedupes the DB job with the *same* `gen_<sha256(key)[0:24]>` job id the
  worker will use, then enqueues through the §11 API. `liveSync()` polls,
  appends unseen worker events, mirrors in-flight status, and on a terminal
  state runs one guarded `finalize()` that persists a PageVersion (L1-validated)
  or records the worker's real error code — never a fabricated state.
  Concurrent syncs are serialized per job (`runExclusive`) so polling never
  races the finalize/`saveVersion` path.
- **Idempotent resilience:** re-POST of the same body returns the existing job
  (200, same `jobId`); a new attempt after a terminal failure gets a fresh
  nonce → a new job id. Worker loss mid-flight → honest `E-JOB-004`.
- **Error envelope:** 4xx carry their real code; 5xx collapse to generic
  `E-INTERNAL-001` so nothing leaks. Client-visible errors (validation,
  conflicts, CSRF 403) are precise.
- **Test seams:** `setGenerationServiceFactory` swaps `HttpWorkerClient` for
  (a) `FakeWorkerClient` in the DB-backed integration suite, and (b) a live
  in-process bridge — the real worker fastify app + processor + in-memory
  queue driver wired to a spawned real ai-engine (stub provider) — in the J1
  e2e. Routes are unchanged under both.
- **Preview:** `GET /api/v1/pages/:id` serves the latest `PageVersion`; the
  same renderer components that the design system validated render it.

## Consequences

**Positive** — every job state a user sees comes from the real pipeline; the
J1 e2e proves browser→API→Postgres→worker→engine→schema→version→preview with no
mock at the leaf; security (session+CSRF) is tested at the API layer; the web
stays RSC-correct with inline styles; package-boundary discipline is enforced
by the build.

**Trade-offs / notes** — each generation is double-dispatched (DB row + worker
API) by design so idempotency holds at both layers; `liveSync` runs lazily on
read (acceptable at this scale, revisit with server events/SSE); `saveVersion`
uses `versionNumber = current + 1`, so the **first draft is version 1** (tests
assert `1`, not `0`); the web e2e skips itself when
`apps/ai-engine/.venv` is absent (dev-only); production needs `DATABASE_URL` +
`WORKER_URL` wired and the worker running, and a job whose worker is gone
fails honestly rather than spinning. Session rotation, rate limiting, TLS and
S3-backed assets are deployment-phase concerns.