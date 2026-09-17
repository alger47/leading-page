# Operations Runbook — Leading Page AI

**Audience:** whoever deploys, monitors, backs up, or debugs the platform.
**Companion:** [`production-readiness.md`](./production-readiness.md) (what is
production-ready and why) · [`security.md`](./security.md) (threat matrix).

All commands assume PowerShell on Windows and the repo root:

```powershell
$repo = "F:\PRATIQUE\LEADING PAGE"
```

---

## 1. Services & ports

| Service | Dev port | Health | Logs |
|---|---|---|---|
| web (Next.js) | 3000 | `GET /api/v1/healthz` | platform / `docker compose logs web` |
| worker (Fastify + BullMQ) | 8080 | `GET /healthz` | `docker compose logs worker` |
| ai-engine (FastAPI) | 8000 | `GET /healthz` | `docker compose logs engine` |
| PostgreSQL | 5432 (internal) | `pg_isready` | platform |
| Redis (BullMQ) | 6379 (internal) | `redis-cli ping` | platform |

`web/healthz` returns `{"status":"ok|degraded","db":"ok|error", ...}`. A
`degraded` status means the DB ping failed — page requests will fail too.

---

## 2. Pre-deploy checklist

1. Working tree is the intended commit; `git log --oneline -1`.
2. Required secrets exist **in the target environment only** (never in git):
   `AI_INTERNAL_TOKEN`, `WORKER_INTERNAL_TOKEN` (32+ random bytes, distinct),
   `DATABASE_URL`, `REDIS_URL`, provider key.
3. `PUBLIC_BASE_URL` and `PUBLIC_HOST_SUFFIX` point at the real HTTPS domain.
4. Local gates green:

   ```powershell
   pnpm build
   pnpm test
   pnpm typecheck
   pnpm qa
   ```

5. For the compose path only: `docker compose config && docker compose build`.

Generate a token:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 3. Deploy — platform (Render, primary)

The repo ships `render.yaml`. First-time setup:

1. Render Dashboard → **New → Blueprint** → connect the repository.
2. The Blueprint creates `landing-ai-db`, `cache`, `web`, `worker`, `ai-engine`.
   Tokens are generated and cross-wired automatically.
3. Set the two `sync: false` values in the dashboard:
   - `ai-engine` → `AI_OPENAI_API_KEY` (provider key; rotate before public use).
   - `web` → `WORKER_URL` if the worker's host differs from the committed one.
4. For real generation: `ai-engine` → `AI_PROVIDER=openai`,
   `AI_OPENAI_BASE_URL=https://api.groq.com/openai/v1`,
   `AI_ROUTING_CONFIG_PATH=config/routing.groq.yaml`.
5. Deploy. Each push to the connected branch redeploys affected services.

Custom domain (published pages):

1. Add the apex + a wildcard `*.<PUBLIC_HOST_SUFFIX>` custom domain to `web`
   (wildcard needs a paid plan on some platforms; otherwise publish under the
   provider's default host and set `PUBLIC_HOST_SUFFIX` to it).
2. Point DNS CNAME records at the service; wait for the certificate to issue.
3. Set `PUBLIC_BASE_URL=https://<domain>` and `PUBLIC_HOST_SUFFIX=<domain>` on
   `web`, then redeploy.

---

## 4. Deploy — self-hosted (docker compose)

```powershell
cd $repo
Copy-Item docker-compose.env.example .env
# edit .env: POSTGRES_PASSWORD, AI_INTERNAL_TOKEN, WORKER_INTERNAL_TOKEN
docker compose config              # syntax + interpolation gate
docker compose build               # first build is slow (pnpm + pip installs)
docker compose up -d
docker compose ps                  # all healthy, migrate exited 0
```

The `migrate` one-shot runs `prisma migrate deploy` before `web`/`worker` start
(the migration path in production-readiness §3). Behind TLS terminate at a
reverse proxy and set `COOKIE_SECURE=1` in `.env`.

```powershell
docker compose logs -f web worker engine
docker compose down                # keep volumes (db/cache data)
docker compose down -v             # DESTROY data (never in production)
```

---

## 5. Post-deploy smoke test

```powershell
$base = "https://<domain>"        # or http://localhost:3000
Invoke-RestMethod "$base/api/v1/healthz"          # status = ok
Invoke-RestMethod "https://<worker-host>/healthz" # engine reachable
```

Happy path (register → project → page → generate → COMPLETED):

1. Register + log in at `$base/register` (the browser keeps the `sid`/`csrf`
   cookies; API clients must send `x-csrf-token` on mutations).
2. Create a project and a page, submit a brief, watch the job reach
   `COMPLETED` on the page view.
3. Open the preview; publish a version and load the resulting
   `p/<host>` URL. Unpublish → the public URL 404s.

Or run the automated gates: `pnpm qa` (L1/L2 + L3 + budget) and `pnpm perf`.

---

## 6. Migrations

```powershell
# status (any environment)
pnpm --filter @landing-ai/database exec prisma migrate status

# apply pending migrations (production path)
pnpm --filter @landing-ai/database migrate:deploy

# author a migration (dev only)
pnpm --filter @landing-ai/database migrate:dev --name <change>
```

Rules: **take a backup before a production migration** (§7); migrations are
forward-only and never edited after shipping; there is no automatic down
migration — roll back by restoring the dump and redeploying the previous commit
(§8).

---

## 7. Backups & restore

```powershell
# plan only (no file written)
pnpm --filter @landing-ai/database backup:dry-run
# write backups/<db>-<UTC timestamp>.dump (custom format), prune to BACKUP_RETENTION
pnpm --filter @landing-ai/database backup
```

Environment: `BACKUP_DIR` (default `backups/`), `BACKUP_RETENTION` (default 7),
`PG_DUMP_BIN` (full path when `pg_dump` is not on `PATH`).

Restore into a target database:

```powershell
$env:PGPASSWORD = "<password>"
pg_restore --clean --if-exists --no-owner -d "<DATABASE_URL>" "backups\landing_ai-<ts>.dump"
pnpm --filter @landing-ai/database exec prisma migrate status
```

Managed free-tier Postgres often has no automated backups — schedule `backup`
externally (cron / GitHub Action) against the **external** connection string and
store dumps off-host. Verify a restore into a scratch DB once per release cycle.

---

## 8. Rollback

| Scenario | Action |
|---|---|
| Bad application deploy (platform) | Render Dashboard → service → **Events → Rollback**, or redeploy the previous commit. |
| Bad application deploy (compose) | `git checkout <previous-commit-or-tag>` → `docker compose up -d --build <service>`. |
| Bad migration | Restore the pre-migration dump (§7) into the DB, then deploy the previous commit/image. There is no down migration. |
| Full baseline restore | `git checkout baseline-2026-09-16` (immutable tag; see `docs/architecture-roadmap.md`). |
| Bad config only | Fix the env var in the dashboard/`.env` and restart the service — no rebuild needed for most vars. |

---

## 9. Monitoring & health

- Wire an external uptime monitor to all three health endpoints; alert on
  non-200 or `status=degraded`.
- Job state: `GET /api/jobs/:id` + `/events` + `/spans` (worker API, token).
- Persisted attempts/cost: `GenerationAttempt` rows (query via `psql`/Prisma).
- Quality/cost trend: `apps/ai-engine/evaluation/reports/metrics-live.{md,json}`;
  regenerate with `python -m app.evaluation.regression` / `nightly`.
- Perf: `pnpm perf` (render, LCP/CLS, bundle budget, golden generation latency).
- Rate limits: watch `429 RATE_LIMITED` responses; tune `RATE_LIMIT_CAPACITY` /
  `RATE_LIMIT_REFILL_PER_SECOND` (edge/gateway limiter for multi-instance).

---

## 10. Incident playbooks

| Symptom | Likely cause | Action |
|---|---|---|
| Worker exits at boot (production) | `WORKER_INTERNAL_TOKEN`/`AI_INTERNAL_TOKEN` still the dev default | set real secrets; restart (§11) |
| Web `POST /generate` 500 `E-INTERNAL-001` | worker token unset/dev default in production (`GenerationService` guard) | set `WORKER_INTERNAL_TOKEN` (web + worker must match) |
| Worker 401 from engine | token mismatch | align `AI_INTERNAL_TOKEN` on both services; restart both |
| Jobs stuck `QUEUED` | worker down, or Redis unreachable | check worker `/healthz`; check `REDIS_URL`; restart worker |
| Jobs fail `E-JOB-001` | engine 5xx/timeouts after retries | check engine `/healthz` + provider status; raise `ENGINE_TIMEOUT_MS` for slow LLMs |
| Jobs fail `E-AI-002` | cost budget hit | review `AI_JOB_DEFAULT_BUDGET_USD` / routing |
| Jobs fail `E-AI-004` | output invalid after repair ladder | expected honest failure; inspect job attempts/validation |
| Provider `429` / `insufficient_quota` | LLM rate/credit limit | back off / rotate key; as a fallback switch `AI_PROVIDER=stub` to keep the platform usable |
| `web/healthz` `degraded` | DB unreachable | check Postgres status / `DATABASE_URL`; connectivity |
| Login redirects but stays logged out | `Secure` cookie over plain HTTP | upload over HTTPS, or set `COOKIE_SECURE=0` behind a TLS proxy only for dry runs |
| Mutations 403 `E-CSRF-001` | missing/!stale `x-csrf-token` | send the `csrf` cookie value in the header; re-login if stale |
| Public page 404 | version unpublished, or host/suffix mismatch | republish; verify `PUBLIC_HOST_SUFFIX` + DNS wildcard |
| `429 RATE_LIMITED` in normal use | limit too low / shared IP | raise capacity, or `RATE_LIMIT_DISABLED=1` for internal tools |
| Local `j*-e2e` hang (240 s) | `apps/ai-engine/.env` points at a real provider | rename/remove `apps/ai-engine/.env` for the run (local only) |
| Local engine CLI hangs | same `.env`/`routing.local.yaml` cause | same fix; use the stub config for local CI |

---

## 11. Secret rotation

Rotate `AI_INTERNAL_TOKEN` (engine ↔ worker) and `WORKER_INTERNAL_TOKEN`
(web ↔ worker) by updating **both** sides and restarting the two services; a
mismatch is visible as `401` on the affected hop. Rotate the provider key in the
provider console, update `AI_OPENAI_API_KEY` in the platform environment only,
and restart `ai-engine`. Rotate the database password through the platform's
managed credentials (no app code change; `DATABASE_URL` is injected). Rotating a
service token does **not** invalidate user sessions (those are DB-backed).

---

## 12. Logs

| Context | Where |
|---|---|
| Platform | Render → service → Logs (stdout) |
| Compose | `docker compose logs -f <service>` |
| Worker structured events | stdout JSON via `@landing-ai/telemetry`; `X-Trace-Id`-style correlation in log context |
| Engine | stdout; reports under `apps/ai-engine/evaluation/reports/` |

Error codes are the search key: web `E-*` (`lib/api.ts`), worker `E-JOB-*`
(`apps/worker/src/jobs/types.ts`), engine `E-AI-*`/`E-BUILD-*`
(`apps/ai-engine/app/core/errors.py`).

---

## 13. Local verification commands (baseline)

```powershell
# TS packages + apps
pnpm build; pnpm test; pnpm typecheck
pnpm qa          # L1/L2 fixtures + L3 visual baseline + published budget
pnpm perf        # render/vitals + golden generation latency

# DB-backed integration (always point at the test DB — never the live one)
$env:DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/landing_ai_test"
pnpm --filter @landing-ai/web exec vitest run --config vitest.integration.config.ts `
  tests/api.integration.test.ts tests/security.integration.test.ts

# AI engine
cd apps\ai-engine
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\ruff.exe check .
.\.venv\Scripts\python.exe -m mypy app
```

---

## 14. Known environment caveats

- **No Docker daemon in the authoring environment** — `docker compose config`
  passes here (Compose v5.5.1) and the Dockerfiles were statically audited, but
  the images were never built; run `docker compose build && docker compose up`
  before the first real deploy.
- **`apps/ai-engine/.env`** makes local e2e/CLI runs use a real provider and
  hang; remove/rename it for local CI (see §10). Its provider key was rotated on
  2026-09-17 (new key verified live) and the duplicate plaintext `مفتاح.txt`
  removed; revoke the old key in the provider console before deploy.
- **mypy** reports two pre-existing errors in
  `apps/ai-engine/app/services/validate.py`; unrelated to deployment.
- **Integration tests default to `landing_ai`** in the app under test — always
  export `DATABASE_URL` pointing at `landing_ai_test` before running them.
