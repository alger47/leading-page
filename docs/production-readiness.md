# Production Readiness & Handover — Phase 15

**Date:** 2026-09-17
**Scope:** PART XV §15.1 — env config · production migration path · deployment
(docker compose → platform) · HTTPS · cookies · CORS · backups · monitoring ·
error reporting · CDN · domain configuration.
**Status:** implemented and evidenced; residual risks listed in §10.

This document is the handover map: what is production-ready, how it is
configured, how it is deployed, and what remains deliberately deferred. The
day-to-day procedures live in [`runbook.md`](./runbook.md).

---

## 1. Deployment topology

```
                    ┌──────────────────────────── Render edge (TLS) ───────────────────────────┐
 browser ── HTTPS ─▶│  web (Next.js, Node)   worker (Fastify/BullMQ)   ai-engine (FastAPI)     │
                    └───────┬────────────────────────┬───────────────────────────┬─────────────┘
                            │ DATABASE_URL           │ REDIS_URL                 │ AI_ENGINE_URL
                        PostgreSQL               Redis (Key Value)          (worker → engine,
                                                                             X-Internal-Token)
```

Two supported deployment paths, identical build commands and the same
internal-token contract:

| Path | Artifact | Use |
|---|---|---|
| **Platform (managed)** | [`render.yaml`](../render.yaml) | Primary. Render Blueprint: managed Postgres + Key Value + 3 web services + automatic TLS, health checks and `generateValue` secrets. |
| **Self-hosted (single host)** | [`docker-compose.yml`](../docker-compose.yml) + `apps/*/Dockerfile` | Portable/on-prem or air-gapped. Postgres + Redis + engine + worker + web on one Docker network. |

The self-hosted path's Compose model **passes `docker compose config`** (validated
with the official Compose v5.5.1 binary: services, volumes, build contexts,
`depends_on` conditions and required-variable guards all resolve), but the images
have **not been built or run** here (no Docker daemon — see §10.1). Run
`docker compose build` and a smoke `up` before first use.

### Render topology (render.yaml)

- `web` — `pnpm --filter @landing-ai/web start`; health `GET /api/v1/healthz`.
- `worker` — `pnpm --filter @landing-ai/worker start`; health `GET /healthz`.
- `ai-engine` — `uvicorn app.main:app`; health `GET /healthz`.
- `cache` — Redis Key Value, `maxmemoryPolicy: noeviction` (eviction would drop
  queued jobs).
- `landing-ai-db` — managed PostgreSQL; `DATABASE_URL` injected into `web`.
- Secrets: `WORKER_INTERNAL_TOKEN` / `AI_INTERNAL_TOKEN` are `generateValue: true`
  and propagated with `fromService` (never typed by hand). `AI_OPENAI_API_KEY`
  is `sync: false` (set once in the dashboard; never in git).
- `AI_PROVIDER=stub` by default. Real generation: set `AI_OPENAI_API_KEY` +
  `AI_OPENAI_BASE_URL=https://api.groq.com/openai/v1` and flip
  `AI_PROVIDER=openai` (routing config `config/routing.groq.yaml`).

> Free-plan caveat: free web services cannot receive private-network traffic, so
> `web → worker` and `worker → engine` go over public URLs authenticated by the
> shared token. For a paid plan, switch the internal hops to Render private
> networking and keep the tokens.

---

## 2. Environment matrix

Every knob is documented in `.env.example` files. **Production requires the
bold values**; the fail-closed guards (§5) refuse to boot otherwise.

### web (`apps/web/.env.example`)

| Var | Default (dev) | Production |
|---|---|---|
| `NODE_ENV` | `development` | **`production`** |
| `DATABASE_URL` | local postgres | **managed connection string** |
| `WORKER_URL` | `http://localhost:8080` | **worker HTTPS URL** |
| `WORKER_INTERNAL_TOKEN` | `dev-worker-token` | **real secret, 32+ bytes** |
| `SESSION_COOKIE_NAME` / `CSRF_COOKIE_NAME` | `sid` / `csrf` | unchanged |
| `SESSION_TTL_DAYS` | `30` | as desired |
| `COOKIE_SECURE` | derived | **omitted** (derives `true` from `NODE_ENV`); set `1` explicitly only when TLS is terminated off-box |
| `PUBLIC_BASE_URL` | `http://localhost:3000` | **`https://<platform-domain>`** |
| `PUBLIC_HOST_SUFFIX` | `landing-ai.test` | **`<platform-domain>`** |
| `RATE_LIMIT_CAPACITY` / `RATE_LIMIT_REFILL_PER_SECOND` | `60` / `1` | tune to traffic; front multi-instance with an edge limiter |
| `ASSET_STORAGE_DRIVER` (+ `ASSET_S3_*`) | `local` | **`s3`** + bucket/region/keys (or `NEXT_PUBLIC_ASSET_S3_BASE_URL` for a CDN) |

### worker (`apps/worker/.env.example`)

| Var | Default (dev) | Production |
|---|---|---|
| `NODE_ENV` | — | **`production`** |
| `PORT` | `8080` | as injected |
| `REDIS_URL` | `redis://localhost:6379` (or `memory://`) | **managed Redis URL** |
| `AI_ENGINE_URL` | `http://localhost:8000` | **engine URL** |
| `AI_INTERNAL_TOKEN` | `dev-internal-token` | **real secret** |
| `WORKER_INTERNAL_TOKEN` | `dev-worker-token` | **real secret** |
| `QUEUE_NAME` | `generation-jobs` | unchanged |
| `ENGINE_TIMEOUT_MS` | `120000` | `300000` (render.yaml) for real LLMs |
| `MAX_ATTEMPTS` / `RETRY_AFTER_MS` | `3` / `1000` | unchanged |

### ai-engine (`apps/ai-engine/.env.example`, prefix `AI_`)

| Var | Default | Production |
|---|---|---|
| `AI_ENV` | `development` | `production` |
| `AI_INTERNAL_TOKEN` | `dev-internal-token` | **same value as worker's `AI_INTERNAL_TOKEN`** |
| `AI_PROVIDER` | `stub` | `openai` (Groq/OpenAI) once a key exists |
| `AI_ROUTING_CONFIG_PATH` | `config/routing.yaml` | `config/routing.groq.yaml` |
| `AI_PAGE_SCHEMA_DIR` | repo path | `/packages/page-schema/schema` (Docker image bakes it) |
| `AI_OPENAI_API_KEY` / `AI_OPENAI_BASE_URL` | empty / OpenAI | **provider key** / `https://api.groq.com/openai/v1` |
| `AI_JOB_DEFAULT_BUDGET_USD`, `AI_JOB_MAX_TOTAL_ATTEMPTS`, `AI_MAX_BRIEF_LENGTH` | `0.25` / `18` / `4000` | tune per cost policy |

### database / backups (`packages/database/.env.example`)

`DATABASE_URL` plus `BACKUP_DIR` (default `backups/`), `BACKUP_RETENTION`
(default `7`), and `PG_DUMP_BIN`/`PG_BIN` when `pg_dump` is not on `PATH`.

**Removed dead names:** root `.env.example` no longer lists the unused
`AI_ENGINE_API_KEY` / `NEXT_PUBLIC_APP_URL` / `PLATFORM_ROOT_DOMAIN`; the real
boundary tokens are `AI_INTERNAL_TOKEN` (worker → engine) and
`WORKER_INTERNAL_TOKEN` (web → worker).

---

## 3. Production migration path

- **Forward-only** migrations (ADR-0005 §10.3); a migration is reviewed SQL and
  never edited after it ships.
- **Platform:** `web` build runs `pnpm --filter @landing-ai/database migrate:deploy`
  before `turbo build --filter @landing-ai/web` (render.yaml), so the schema is
  always ahead of the served code.
- **Self-hosted:** the one-shot `migrate` service runs the same
  `migrate:deploy` and `web`/`worker` wait on
  `service_completed_successfully` — no request is served against an
  unmigrated schema.
- **Local dev:** `pnpm --filter @landing-ai/database migrate:dev` (interactive)
  and `db:reset`; tests replay migrations onto `landing_ai_test` per run.
- **Before any production migration:** take a backup (§6). There is no
  auto-down migration — roll back by restoring the dump and redeploying the
  previous image/commit (runbook §6).

---

## 4. HTTPS, cookies, CORS

### HTTPS
- **Platform:** TLS is terminated at the Render edge with managed certificates;
  HTTP is redirected automatically.
- **Self-hosted:** the compose stack serves plain HTTP on `:3000`; put it behind
  a TLS reverse proxy (Caddy/Traefik/nginx) and set `COOKIE_SECURE=1`.
- `next.config.mjs` sends **`Strict-Transport-Security: max-age=63072000;
  includeSubDomains`** on every response (Phase 15). `preload` is deliberately
  omitted — it is a hard-to-reverse commitment and stays an explicit ops step.
  Browsers ignore HSTS over plain HTTP, so local dev is unaffected.
- HTTPS is also required for `Secure` cookies to be sent (§4.2).

### Cookies (policy is centralized)
`lib/api.ts` exports `sessionCookieFlags` / `csrfCookieFlags`; every set and
clear path uses them, so flags cannot drift:

| Cookie | HttpOnly | SameSite | Secure | Path |
|---|---|---|---|---|
| session (`sid`) | **yes** | `strict` | prod = `true` (`COOKIE_SECURE` override) | `/` |
| CSRF (`csrf`) | no (double-submit needs JS) | `strict` | prod = `true` | `/` |

Session tokens are opaque 32-byte random values; only their SHA-256 hash is
persisted (`AuthSessionRepository`). Logout revokes the DB row and clears both
cookies with the same flags. `Secure` derivation is covered by
`tests/env.test.ts`; flag output by `sessionCookieFlags`/`csrfCookieFlags`.
**Deferred:** `__Host-` cookie-name prefix and session rotation on privilege
change (§10).

### CORS
The architecture is **same-origin by design**: the browser talks only to the web
app; the worker and engine are server-to-server and protected by the shared
`X-Internal-Token`, never exposed to browser JS. Consequently **no CORS
middleware is added** — emitting `Access-Control-Allow-*` would only widen the
surface. If a future CDN/edge client needs cross-origin access, add an explicit
allow-list at that layer, not a wildcard.

---

## 5. Fail-closed production guards

| Guard | Where | Behaviour |
|---|---|---|
| Worker token defaults | `apps/worker/src/config.ts` (`assertProdConfig`) | refuses to boot under `NODE_ENV=production` when `WORKER_INTERNAL_TOKEN` or `AI_INTERNAL_TOKEN` is the well-known dev value |
| Web worker token | `apps/web/lib/generation-service.ts` | throws per request in production when the dev token would be used (guard at the request boundary, not in `webConfig()` which also runs at build time) |
| Cookies | `apps/web/lib/env.ts` | `Secure` defaults on in production |
| Secrets | `.gitignore` + gitleaks CI job | keys never committed; CI blocks accidental commits |

---

## 6. Backups & restore

Implemented in `packages/database/scripts/backup.ts` (GAP-6):

```powershell
# dry-run first (prints plan, writes nothing)
pnpm --filter @landing-ai/database backup:dry-run
# real backup → backups/<db>-<YYYYMMDDTHHMMSSZ>.dump (custom format, compressed)
pnpm --filter @landing-ai/database backup
```

- Resolves `pg_dump` via `PG_DUMP_BIN` → `PG_BIN` → `PATH` → known Windows
  paths; retention keeps the newest `BACKUP_RETENTION` (default 7) dumps.
- **Restore:** `pg_restore --clean --if-exists --no-owner -d <DATABASE_URL> <file.dump>`.
- **Managed Postgres:** free tiers often do not include automated backups.
  Schedule the script externally (cron / GitHub Action) against the database's
  **external** connection string, and store dumps off-host.
- **Verify a backup** at least once per release cycle by restoring into a scratch
  database and running `prisma migrate status` + the smoke path (runbook §4.5).

---

## 7. Monitoring

| Layer | Signal | Where |
|---|---|---|
| Liveness/readiness | `GET /api/v1/healthz` (web, DB ping), `GET /healthz` (worker, engine reachability), `GET /healthz` (engine) | wired as platform health checks; point an external uptime monitor at all three |
| Jobs | lifecycle events (`job.queued → … → job.completed/failed/cancelled`), per-job spans | `GET /api/jobs/:id/events`, `…/spans`; stored in DB attempts (`GenerationAttempt`) |
| Telemetry | structured JSON logger, `MemorySpanStore`, `InMemoryMetrics` (§12 metric catalog: jobs, stage seconds, attempts, tokens, cost, validation failures, render fallbacks) | `@landing-ai/telemetry`, consumed by the worker (GAP-1/GAP-3) |
| Quality/cost | golden regression metrics, per-stage latency p50/p95, cost per successful page, live metrics | `apps/ai-engine/evaluation/reports/metrics-live.md`; `pnpm perf` |
| API protection | 429 `RATE_LIMITED` + `Retry-After` + `X-RateLimit-*` | `apps/web/middleware.ts` |

**Not wired (deliberate):** no external APM/SaaS agent ships in the images.
`InMemoryMetrics`/`MemorySpanStore` are process-local; wire them to a
collector (OpenTelemetry/Prometheus) when a target exists. Until then, rely on
platform logs + the health endpoints + the engine's committed reports.

---

## 8. Error reporting

- **Stable contract:** every API error is `{ error: { code, message, details?,
  docs } }` with a real code for 4xx/5xx (e.g. `E-AUTH-002`, `E-JOB-001`,
  `E-AI-004`, `E-PUBLISH-001`, `E-CSRF-001`).
- **No internal leakage:** `jsonError` (`apps/web/lib/api.ts`) collapses all 5xx
  to `E-INTERNAL-001` with a generic message; `healthz` never discloses env
  presence. Codes are the debugging key — search the code + CHANGELOG for them.
- **Single seam for a reporter:** when an error-reporting SDK is adopted,
  instrument `jsonError` (web), the Fastify error handler (worker) and the
  engine exception handlers — one place each. No SDK is bundled today.
- **Known gap:** the `docs` link in the envelope points at a `/docs/errors/<code>`
  route that is not served yet (codes are documented in code/CHANGELOG). Tracked
  in §10.

---

## 9. CDN & domain configuration

- **Published pages:** a page is served at
  `${PUBLIC_BASE_URL}/${host}` where `host = p-<pageIdTail>.<PUBLIC_HOST_SUFFIX>`.
  Production needs:
  1. DNS: wildcard `*.PUBLIC_HOST_SUFFIX` → the platform (CNAME) plus the apex.
  2. TLS: a certificate covering the wildcard (Render custom domain, or the
     reverse proxy's wildcard cert).
  3. `PUBLIC_BASE_URL` / `PUBLIC_HOST_SUFFIX` set to the real domain.
- **Assets:** `ASSET_STORAGE_DRIVER=s3` with an S3-compatible bucket serves
  uploads; `NEXT_PUBLIC_ASSET_S3_BASE_URL` points the renderer at a CDN host
  (`img-src` in the CSP already allows `https:`). Default stays the
  self-hosted `/assets/asset/{ref}` placeholder.
- **CDN (optional):** published HTML is immutable per snapshot; a CDN can cache
  the public `[host]` route. Cookie-bearing dashboard routes must not be cached.
  No CDN is configured by default (nothing to invalidate, no cache-poisoning
  surface).

---

## 10. Residual risks (carried from `docs/security.md`) & deferred items

1. **Docker images not built here** — the Compose model passes `docker compose
   config` (v5.5.1) and the Dockerfiles were statically audited (COPY sources,
   scripts, contexts, build args all resolve), but there is no daemon to
   `build`/`run`; `docker compose build && docker compose up` is a mandatory
   pre-deploy gate.
2. **Groq provider key must be rotated** before any public deploy. The key is
   still live in `apps/ai-engine/.env` (as `AI_OPENAI_API_KEY`, used because Groq
   is OpenAI-compatible) and duplicated in the git-ignored plaintext
   `مفتاح.txt`; it was also exposed in a local terminal transcript. Revoke it in
   the Groq console, mint a new one, and set the new key only in the deployment
   environment. Neither file is tracked nor present in git history (`.gitignore`
   covers `.env` and `*مفتاح*.txt`).
3. **CSP `unsafe-inline`/`unsafe-eval`** remain (Next inline bootstrap). XSS is
   closed at the source (L1 href-scheme gate, renderer guard, SVG escaping);
   revisit when Next/React drop inline bootstraps.
4. **Engine input provenance / prompt-injection hardening** — briefs are treated
   as data and the injection case is reported, but the engine has no hard
   provenance boundary; hardening is a future phase.
5. **Published-route query performance** — per-query `EXPLAIN` tuning of the
   published-page lookups has not been done (no measured hotspot; the publish
   path is snapshot-based).
6. **Session hardening** — no `__Host-` cookie-name prefix and no rotation on
   privilege change.
7. **Error-reporting link** — `/docs/errors/<code>` route is not served.
8. **Ownership-check ordering** — `POST /projects/{id}/pages` and `/generate`
   validate the body before the ownership check (they never leak foreign
   content; ordering polish only).

---

## 11. Acceptance checklist (PART XV §15.1)

| Item | Artifact / evidence | Status |
|---|---|---|
| Env config | per-service `.env.example` + matrix §2; dead names removed | ✅ |
| Prod migrations path | `migrate:deploy` in render.yaml + compose `migrate` service; §3 | ✅ |
| Deployment (compose → platform) | `docker-compose.yml`, `apps/*/Dockerfile`, `render.yaml`; §1 | ✅ (`docker compose config` v5.5.1; image `build` pending a daemon) |
| HTTPS | platform TLS + HSTS header + test; §4.1 | ✅ |
| Cookies | centralized flags + `Secure` in prod + tests; §4.2 | ✅ |
| CORS | same-origin by design (documented); §4.3 | ✅ |
| Backups | `backup.ts` + retention + restore; §6 | ✅ |
| Monitoring | healthz ×3 + telemetry + reports; §7 | ✅ (collector not wired) |
| Error reporting | stable codes + 5xx collapse + single seam; §8 | ✅ (no SDK) |
| CDN | asset base URL + public-route notes; §9 | ✅ (optional, not configured) |
| Domain config | `PUBLIC_BASE_URL`/`PUBLIC_HOST_SUFFIX` + DNS/TLS steps; §9 | ✅ |
| Handover docs | this file + `runbook.md` + walkthrough §Phase 15 | ✅ |
