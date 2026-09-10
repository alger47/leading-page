# API Reference — `apps/web` `/api/v1`

Base URL: `http://localhost:3000/api/v1`. All endpoints return JSON.

## Conventions

- **Auth:** most endpoints require a session cookie (`sid`, httpOnly) set at
  register/login. Unauthenticated → `401`.
- **CSRF:** every mutating endpoint (POST/DELETE) requires `x-csrf-token`
  equal to the value of the `csrf` cookie (double-submit). Missing/mismatched →
  `403`.
- **Error envelope:** `{ error: { code, message, details?, docs? } }`.
  4xx keep their real code; 5xx collapse to generic `E-INTERNAL-001`.
- **Ownership (§10.5):** every row is resolved under the authenticated
  `Owner { userId }`; touching another user's resource → `404` (no existence
  disclosure).

## Auth

### `POST /auth/register`
Body: `{ email, name, password }`. Validates email/name/password strength.
- `201` `{ user: { id, email, name } }` + sets `sid`/`csrf` cookies.
- `409` duplicate email.
- `422` invalid input.

### `POST /auth/login`
Body: `{ email, password }`.
- `200` `{ user: { id, email, name } }` + sets cookies.
- `401` `E-AUTH-002` invalid credentials.

### `POST /auth/logout`
- `200` `{ ok: true }`, clears `sid`.

### `GET /auth/me`
- `200` `{ user: { id, email, name } }`.
- `401` not logged in.

## Projects & pages

### `POST /projects`
Body: `{ name }`.
- `201` `{ project }` (includes list of pages).
- `422` missing/invalid name.

### `GET /projects`
- `200` `{ projects: ProjectView[] }` (owned, non-archived).

### `GET /projects/[projectId]`
- `200` `{ project }`.
- `404` not found / foreign.

### `POST /projects/[projectId]/pages`
Body: `{ title, locale? }`.
- `201` `{ page }`.
- `404` foreign project; `422` invalid title/locale.

### `GET /projects/[projectId]/pages`
- `200` `{ pages: PageView[] }` (owned pages of the project).

### `GET /pages/[pageId]`
Page detail for preview.
- `200` `{ page: { ...page, latestVersion: { content, versionNumber } | null } }`.
  `latestVersion.content` is the latest L1-valid Page Schema envelope.
- `404` foreign/missing.

## Generation

### `POST /generate`
Body: `{ projectId, pageId, brief, locale: 'ar'|'fr'|'en', tone }`.
- `202` `{ jobId, status: 'QUEUED' }` — job created and handed to the worker.
- `200` `{ jobId, status }` — idempotent replay: the same body + same project
  + same page returns the existing in-flight/terminal job.
- `401`/`403` auth/CSRF; `404` foreign project/page; `422` `E-VAL-BRIEF`
  (brief too short/too long/blank, bad locale or unsupported tone).

Idempotency: the key is `doc:{userId}:{pageId}:{retryNonce}` where retryNonce
is the number of prior terminal `FAILED`/`CANCELLED` jobs for that page — a new
attempt after a failure gets a **new** job id (honest, never a replayed stale
one).

### `GET /generation-jobs/[jobId]`
Mirrors the worker into Postgres (`liveSync`) and returns the DB source of truth:
- `200` `{ job: { jobId, status, attemptsMade, errorCode, errorMessage, result, events } }`.
  - `status`: `QUEUED | RUNNING | VALIDATING | RENDERING | COMPLETED | FAILED | CANCELLED`
  - `result` (COMPLETED): `{ pageId, versionNumber }` — a PageVersion was
    persisted with the engine's L1-validated schema.
  - `errorCode` (FAILED): the **real** worker/engine code (e.g. `E-ENGINE-005`,
    `E-JOB-004` worker-loss, `E-VAL-L1` invalid schema).
- `404` foreign/missing.

### `DELETE /generation-jobs/[jobId]`
CSRF-required. Best-effort cancel.
- `200` `{ job, cancelled: boolean }`. Cancels when still `QUEUED`/`RUNNING`;
  terminal jobs are returned unchanged (`cancelled: false`).
- `404` foreign/missing; `409` handled as `cancelled:false`.

## Themes & assets (editor)

### `GET /themes`
Auth required. Owner-scoped. Returns the theme preset registry.
- `200` `{ themes: ThemePreset[] }`, each
  `{ preset, label, description, theme: { font, primaryColor, radius, density }, swatches }`.

### `GET /assets`
Auth required. Owner-scoped stock media.
- `200` `{ assets: Asset[] }`, each `{ id, kind, source, url, alt }`.

## Versions (editor saves + Phase 9 history/restore)

### `GET /pages/[pageId]/versions`
Auth required. Immutable version history, ascending metadata only (content is
excluded).
- `200` `{ versions: [{ versionNumber, schemaVersion, createdAt, createdBy }] }`.
- `404` foreign/missing page.

### `GET /pages/[pageId]/versions/[versionNumber]`
Auth required. Full snapshot of one immutable version.
- `200` `{ version: { versionNumber, schemaVersion, createdAt, createdBy, content } }`.
- `404` unknown version / foreign page.

### `GET /pages/[pageId]/versions/compare?from=:a&to=:b`
Auth required. Server-computed comparison (metadata + section diff summary),
safe to render and never mutating.
- `200` `{ from, to, diff: { metadata, sections, counts } }` where
  `metadata` covers `title` / `locale` / `direction` / `theme`
  (`{ previous, current, changed }`), `sections` is one entry per section id —
  `{ id, type, action: 'added'|'removed'|'unchanged'|'changed',
  previousPosition, currentPosition, changedSlots? }` — and `counts` tallies
  added/removed/changed/unchanged.
- `400` missing/invalid `from`/`to`; `404` foreign page or unknown version.

### `POST /pages/[pageId]/versions/[versionNumber]/restore`
Auth/CSRF required. Restores a previous version as a **new** immutable version
(`§10.2` — restore copies, never rewrites; the snapshot re-passes the L1 gate).
- `200` `{ version: { versionNumber, restoredFrom } }`.
- `404` unknown version / foreign page; `409` if the page changed concurrently.

### `POST /pages/[pageId]/versions`
Auth/CSRF required. Persists a **new immutable draft version** from a validated
envelope. Body: `{ baseVersion, content }` where `content` is a full Page
Schema envelope.
- `200` `{ version: { versionNumber }, warnings }` — new version saved
  (`baseVersion + 1`).
- `409` `E-CONFLICT` — the `baseVersion` is no longer the latest (someone else
  saved first); the client must reload and re-apply.
- `422` `E-VAL-L1` with `error.details.issues` —
  `[{ path, message }]` from the L1 structural validator. Invalid envelopes are
  never persisted.

## Section regeneration

### `POST /pages/[pageId]/regenerate`
Auth/CSRF required. Re-rolls a single section of a chosen version through the
engine. Body: `{ versionNumber, targetSectionId, mode: 'section' }`.
- `202` `{ jobId, status: 'QUEUED' }` — regeneration job handed to the worker.
- `404` foreign page / target section missing; `422` bad body or unknown mode.
- On COMPLETED the job's `result` is
  `{ pageId, versionNumber }` — a new L1-validated version whose non-target
  sections are byte-identical to the version being edited is persisted.
  Failures never produce a half-edited page: the target version stays intact.
- Poll with `GET /generation-jobs/[jobId]`; the editor refreshes (remounts)
  on completion.

## Ops

### `GET /healthz`
No auth. `200` `{ status: 'ok', service: 'web', db, worker }` — liveness plus
Postgres reachability and worker API reachability/health.

## Job lifecycle (web side)

```
POST /generate ─► DB {QUEUED} ─► worker POST /api/jobs (same job id, §11 idempotency)
liveSync (GET job) : mirror worker status + append unseen events
  COMPLETED ─► finalize(): saveVersion(L1-validated) -> COMPLETED {pageId, versionNumber}
  FAILED    ─► record worker's real error.code
  lost      ─► honest E-JOB-004
```

Terminal statuses are final; a worker that completes before the web's first
poll still lands correctly (`QUEUED → COMPLETED` fast path). Reads never
invent states — the DB only ever reflects the worker.