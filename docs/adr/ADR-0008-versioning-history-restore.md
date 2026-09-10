# ADR-0008: Version History, Comparison & Restore (J4)

- **Status:** Accepted (2026-09-10, versioning phase)
- **Relates to:** ADR-0005 §10.2 (immutability + optimistic concurrency),
  ADR-0007 (validated drafts), master catalog "PHASE 9 — Versioning".

## Context

Phase 8 can *save* drafts (each a new validated version) but has no history
UI, no way to see what changed between versions, and no way to go back. J4
wants "restore a previous version", and Phase 9 names the surface: version
list, save draft, restore, compare (metadata + section diff summary).

Anchors already in place:

1. **Versions are immutable rows** (`PageVersion`, ADR-0005 §10.2): no update
   path, `versionNumber = last + 1`, and `saveVersion({ baseVersion })` is the
   only write — validated L1, guarded by optimistic concurrency. Any restore
   that "just saves" inherits all of that for free.
2. **Content lives in JSONB**: key order is not preserved across writes, so any
   equality/diff must be structural, not string-based.

Constraints found while building it:

1. **Section identity is `id`, position is not.** A diff keyed by array order
   would report "everything changed" after a reorder; comparing by stable
   `id` (with `previousPosition`/`currentPosition`) is the honest summary.
2. **The diff must be server-computed** so API/e2e tests and any future client
   share one implementation — and it must never mutate envelopes.
3. **Restore must not be able to corrupt**: the restored snapshot re-enters
   through `saveVersion`'s L1 gate; a schema that *was* valid at vN stays
   valid, but any future-dated migration hazard is caught exactly like any
   other draft.

## Decision

**History/compare/restore as three read routes and one mutating route, all
owner-scoped, with the diff computed by a pure `lib/versions-diff` used by the
route and unit-tested directly.**

- `GET /pages/:id/versions` — metadata list (ascending, content excluded).
- `GET /pages/:id/versions/:v` — full immutable snapshot (metadata + content).
- `GET /pages/:id/versions/compare?from=a&to=b` — `{ from, to, diff }` where
  `diff` = `{ metadata: {title,locale,direction,theme → {previous,current,
  changed}}, sections: [{id,type,action,previousPosition,currentPosition,
  changedSlots?}], counts }`. Sections match by `id`; `changed` sections carry
  `changedSlots` (e.g. `content.title`, `variant`).
- `POST /pages/:id/versions/:v/restore` (CSRF) — reads the target snapshot,
  then `saveVersion({ baseVersion: latest, content: snapshot })` → a **new**
  version; `restoredFrom` returned. Original versions are untouched; an
  optimistic-concurrency race surfaces as 409 "reload and retry".
- The UI (`VersionsView`, client, refreshed on mutation so the editor remounts
  on the new latest) lists history, compares any two versions, and restores.

## Consequences

**Positive** — restore is zero new persistence logic (immutability + OCC +
L1 gate already do the right thing); the diff is a pure function with direct
unit coverage plus server/compare and e2e coverage; history stays intact and
verifiable (the J4 e2e asserts v1..v3 all remain, with the edited v2 byte-equal
to what was saved); cross-tenant access is a uniform 404.

**Trade-offs / notes** — compare/diff is structural equality (JSONB
order-independent), not a token-level text diff (right-sized for section
slots); `changedSlots` reports top-level slot keys, not deep sub-slots; a
"restore the latest onto itself" is allowed and just produces an identical new
version (harmless, documented); publishing a *selected* version remains
PHASE 10 (its acceptance owns the publish gate, snapshot move, subdomain,
noindex and zero-dashboard-JS checks).