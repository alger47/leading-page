# ADR-0011: Production Deployment Topology, Secure Cookies, and Ops Seams (Phase 15)

- **Status:** Accepted (2026-09-17, production readiness phase)
- **Relates to:** ADR-0005 (database persistence — forward-only migrations),
  ADR-0004 (worker/queue), ADR-0009 (publishing/domains); PART XV §15.1
  (production readiness & handover); `docs/production-readiness.md`,
  `docs/runbook.md`.

## Context

PART XV asks for a production handover: environment configuration, a production
migration path, deployment (docker compose → platform), HTTPS, cookies, CORS,
backups, monitoring, error reporting, CDN and domain configuration. The platform
was already operationally shaped by earlier phases:

- `render.yaml` exists (web + worker + ai-engine + managed Postgres + Redis Key
  Value, managed TLS, health checks, generated internal tokens).
- `/healthz` endpoints exist on all three services; the worker consumes the
  `@landing-ai/telemetry` package (structured logger, spans, metrics).
- `packages/database/scripts/backup.ts` implements `pg_dump` + retention.
- `next.config.mjs` ships the security-header baseline; `middleware.ts` adds
  per-IP rate limiting.
- The browser is same-origin with the web app; worker and engine are
  server-to-server behind `X-Internal-Token`.

What was missing: a portable self-hosted deployment artifact, a single
cookie-flag policy, HSTS, an accurate env inventory (the root `.env.example`
still listed unused `AI_ENGINE_API_KEY`/`NEXT_PUBLIC_APP_URL`/
`PLATFORM_ROOT_DOMAIN` names), and the written handover.

## Decision

**1. Two deployment paths, one contract.** The platform path stays
`render.yaml`; the portable path is a root `docker-compose.yml` with per-app
`Dockerfile`s built from the repo root. Both run the identical build commands
from `render.yaml` (`prisma generate` → `turbo build --filter …`; `uvicorn` for
the engine) and share the same token contract and health routes. The compose
stack adds a one-shot `migrate` service (`prisma migrate deploy`) that
`web`/`worker` wait on, so no request is served against an unmigrated schema.

**2. Production migrations are a deploy step, never an inline request.**
`migrate:deploy` runs during the `web` build (Render) or as the `migrate`
one-shot (compose); migrations remain forward-only (ADR-0005 §10.3). Rollback of
a bad migration is a restore, not a down-migration.

**3. TLS is terminated at the edge; the app enforces the cookie/transport
policy.** `next.config.mjs` adds `Strict-Transport-Security` (no `preload` — a
hard-to-reverse commitment kept as an explicit ops step). Cookie flags are
centralized in `lib/api.ts` (`sessionCookieFlags`/`csrfCookieFlags`) and used by
every set/clear path; `Secure` derives from `NODE_ENV=production` with an
explicit `COOKIE_SECURE` override for a plain-HTTP dry run. The session cookie is
`HttpOnly` + `SameSite=strict`; the CSRF cookie is deliberately JS-readable for
the double-submit header.

**4. CORS stays absent by design.** The browser never calls the worker or the
engine, so no `Access-Control-Allow-*` headers are emitted. A future
cross-origin consumer must be an explicit allow-list at the edge, never `*`.

**5. Monitoring and error reporting are seams, not bundled SaaS.** Health
endpoints + `@landing-ai/telemetry` + the engine's committed reports are the
observability surface today. Error reporting uses the stable
`{ error: { code, message, docs } }` envelope with 5xx collapsed to
`E-INTERNAL-001`; the single instrumentation points for a future SDK are
`jsonError` (web), the Fastify error handler (worker) and the engine exception
handlers. No APM/SDK is shipped.

**6. The environment inventory is corrected and complete.** Per-service
`.env.example` files are the source of truth;
`AI_INTERNAL_TOKEN` (worker → engine) and `WORKER_INTERNAL_TOKEN` (web → worker)
replace the stale `AI_ENGINE_API_KEY`; `PUBLIC_BASE_URL`/`PUBLIC_HOST_SUFFIX`
are the canonical published-domain knobs.

## Consequences

**Positive** — the project is deployable from two directions with the same build
and token contracts; migration ordering is enforced, not hoped for; cookie flags
cannot drift between session/CSRF/clear paths and are unit-tested; HSTS and the
env inventory make the HTTPS story explicit; the handover is written down in
`production-readiness.md` + `runbook.md` and the walkthrough debt (Phases
12–14 missing entries) is paid.

**Trade-offs / notes** — the compose stack and Dockerfiles were authored in an
environment **without a Docker daemon**. The Compose model is validated with the
official `docker compose config` binary (v5.5.1) and the Dockerfiles were
statically audited, but the images are **not built here**;
`docker compose build && docker compose up` is a mandatory pre-deploy gate
(runbook §2/§4). No external APM/error-reporting
SDK is wired (deliberate; documented seams). CSP still allows
`unsafe-inline`/`unsafe-eval` for Next's bootstrap (Phase 14 rationale).
Session `__Host-` prefixing, session rotation, engine input-provenance
hardening, and published-route `EXPLAIN` tuning remain documented residual risks
(production-readiness §10).
