# ADR-0005: Database & Persistence — PostgreSQL + Prisma, Tenant-Scoped Repositories

- **Status:** Accepted (2026-09-09, phase 6)
- **Relates to:** PART X §§10.1–10.5 (entity model, integrity, migration policy, audit, tenant scoping), master catalog "Phase 6 role: Database & persistence"

## Context

The platform has no durable layer yet: the worker keeps jobs in a process-local
`MemoryJobStore`, and no tenant/ownership model exists beyond the queue API.
PART X mandates a PostgreSQL entity model (`User ─< Project ─< Page ─<
PageVersion`, `Project ─< GenerationJob ─< GenerationAttempt`, `PageVersion ──<
PublishedPage >── Subdomain`, `PromptVersion`), forward-only migrations, version
immutability, optimistic concurrency on drafts, audit fields with soft deletes,
and **tenant scoping at the repository layer**: "there is no find-by-id without
an ownership filter" (§10.5).

Constraints discovered during bring-up:

1. A local **PostgreSQL 18** service runs on `127.0.0.1:5432` (`postgres`/`postgres`,
   superuser + empty password) — the full migrations + integration suite can run
   for real in this dev environment.
2. Prisma emits our `@unique` fields as **CREATE UNIQUE INDEX** (no `pg_constraint`
   row), so schema-integrity tests introspect `pg_indexes`, not `pg_constraint`.
3. vitest runs files in parallel workers by default; with a shared Postgres schema
   that causes cross-file TRUNCATE races — the DB test suite pins
   `fileParallelism: false` and replays migrations on a fresh schema in
   `globalSetup` (acceptance: "migrations run clean").
4. Page Schema JSONB round-trips re-key objects, so immutability is asserted as
   deep equality, never as byte-for-byte string equality.

## Decision

**PostgreSQL via Prisma ORM (`@landing-ai/database`), forward-only migrations,
repository functions that always receive an `Owner { userId }` and bake the
ownership chain into every SQL predicate.**

- **Schema (`prisma/schema.prisma`):** full §10.1 entity model, snake_cased via
  `@@map`, `@db` column types, `@db.Timestamptz` audit fields, soft deletes
  (`user.deactivatedAt`, `project.archivedAt`, `page.archivedAt`,
  `asset.removedAt`, `published_page.unpublishedAt`), append-only
  `publication_event`. `GenerationJob.status` enum matches the worker's
  `JobStatus` exactly (QUEUED…CANCELLED).
- **Integrity (§10.2):** `@@unique([pageId, versionNumber])`,
  `@unique(idempotencyKey)` (multi-instance dedupe at the DB layer),
  `@unique([stage, version])` prompt registry, `@unique(storageRef)`,
  `@unique(host)`, `@unique([pageId, locale])` published page; FK delete rules
  (`CASCADE` down the ownership tree, `RESTRICT` on page_version → published,
  `SetNull` for job.pageId). Indexes on every ownership FK and on
  `(projectId, status)` / `status`.
- **Repositories (`src/repositories/*`):** `ProjectsRepository`,
  `PagesRepository` (page + version lifecycle), `JobsRepository` (+ attempts),
  `AssetsRepository`, `PublishingRepository` (publish/unpublish + events +
  subdomains), `PromptVersionsRepository`. Every method takes `Owner`; reads use
  `findFirst({ where: { id, project: { id, userId: owner.userId } } })` and writes
  go through `requireOwnedProject`/`requireOwnedPage`. Crossing tenants throws
  `NotFoundError` (never a 403 — existence is not disclosed).
- **Version immutability (§10.2):** `PageVersion` has no update/delete API; a new
  version is always a new row (`saveVersion` inserts `versionNumber = latest + 1`).
  "Restore" copies target content into a new version.
- **Optimistic concurrency (§10.2):** `saveVersion(..., { baseVersion })` inserts
  only when `baseVersion === latest`; a concurrent winner surfaces as an
  `OptimisticConcurrencyError` (or the DB's `P2002` unique-constraint mapped to
  the same error under a read/write race). Exactly one of two concurrent save
  attempts succeeds; the version sequence stays gapless.
- **State machine (§10.2):** `JobsRepository.transition` enforces
  QUEUED → RUNNING → {VALIDATING → RENDERING →} COMPLETED, FAILED/CANCELLED from
  any non-terminal; terminal statuses are final. Events append to a JSONB trail.
- **Migrations:** forward-only; `0001_init` (full model, reviewed SQL) +
  `0002_add_unpublished_at` (single ALTER). `migrate deploy` replays them on the
  test DB in globalSetup; dev DB uses `migrate dev`.
- **Seeds (`prisma/seed.ts`, dev-only per PD-05):** one demo user, a vet project
  whose page is seeded from `valid-vet-ar-001.json` and published, and a SaaS
  project; a COMPLETED job from the real golden brief `vet-ar-001.json` with a
  recorded attempt; the 5 committed engine prompt YAMLs registered as
  `PromptVersion` rows (real sha256 contentHash). Idempotent across re-runs.

## Consequences

- Worker's in-memory store remains for the agent runtime this phase; the DB
  `JobsRepository` already mirrors the worker `JobRecord` semantics so the swap
  (with project context from auth) is local to Phase 7.
- Tests require a reachable PostgreSQL (`DATABASE_URL`, default
  `postgresql://postgres:postgres@127.0.0.1:5432/landing_ai_test`). The suite
  drops/recreates the schema each run.
- Cross-repo: `packages/page-schema` must be built (`dist/`) before the DB tests
  import `@landing-ai/page-schema` (empty repo → build it once).