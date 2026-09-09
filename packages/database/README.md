# @landing-ai/database

PostgreSQL persistence layer for the landing-page platform (PART X of the master
prompt). Prisma schema, forward-only migrations, tenant-scoped repositories.

## Requirements

- Node 18+, pnpm
- A reachable PostgreSQL (dev box: PostgreSQL 18 on `127.0.0.1:5432`)
- `packages/page-schema` built (`pnpm --filter @landing-ai/page-schema build`)

## Environment

| Variable      | Default (dev)                                            | Used by                          |
| ------------- | -------------------------------------------------------- | -------------------------------- |
| `DATABASE_URL`| `postgresql://postgres:postgres@127.0.0.1:5432/landing_ai_test` | tests & Prisma CLI          |

Sets needed for Prisma CLI / seed in this directory:

```powershell
$env:DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/landing_ai'   # dev
$env:DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/landing_ai_test' # tests
```

## Schema & migrations

- `prisma/schema.prisma` — canonical entity model (§10.1), forward-only.
- `prisma/migrations/<ts>_*/migration.sql` — reviewed SQL migrations (never hand
  edited after apply; a new migration is a new file).

```powershell
pnpm exec prisma migrate dev        # create + apply a migration (dev DB)
pnpm exec prisma migrate deploy     # replay pending migrations (CI / test DB)
pnpm generate
```

## Repositories

Every repository method takes an `Owner { userId }` and encodes the ownership
chain (User → Project → Page → Version/Job/Asset) in its SQL predicate (§10.5).
Cross-tenant access throws `NotFoundError` — it never discloses existence.

- `ProjectsRepository` — create/list/get/update/archive (soft delete)
- `PagesRepository` — pages + immutable versions; `saveVersion` with optimistic
  concurrency via `baseVersion`
- `JobsRepository` — GenerationJob lifecycle (state machine + events) +
  GenerationAttempt recording (idempotent per stage/attempt)
- `AssetsRepository` — create/get/list/remove (soft delete)
- `PublishingRepository` — publish / unpublish / publication events (append-only)
  / subdomains
- `PromptVersionsRepository` — read-mostly registry of prompt assets

## Commands

```powershell
pnpm test          # full suite against DATABASE_URL (test DB preferred)
pnpm typecheck
pnpm build
pnpm seed          # dev seeds (PD-05: dev-only, idempotent) — run against dev DB
pnpm db:reset      # wipe + re-migrate (dev only)
```

## Tests

`tests/global-setup.ts` drops the schema and replays every migration on
`DATABASE_URL` (tests run serially — `fileParallelism: false` — because they
share one Postgres schema). Suites:

- **migrate** — migrations run clean; §10.2 constraints/indexes present
- **isolation** — tenant isolation matrix across all repositories (§10.5)
- **immutability** — versions are new rows; restore never rewrites history
- **concurrency** — exactly-one-wins optimistic concurrency
- **jobs** — state machine, idempotency-key dedupe, attempts, list/status
- **published** — snapshot pointer move, append-only publication events