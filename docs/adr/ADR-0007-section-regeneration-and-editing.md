# ADR-0007: Section-Level Editing & Regeneration — Validated Drafts Only

- **Status:** Accepted (2026-09-10, editor phase)
- **Relates to:** ADR-0002 (canonical Page Schema / L1+L2 validation), ADR-0005
  (§10.2 version immutability + optimistic concurrency), ADR-0006 (web app /
  session+CSRF auth), ADR-0004 (worker / engine as async executor), master
  catalog "Phase 7 role: editor + preview".

## Context

Phase 7 shipped generation and preview but no editing: a page was whatever the
engine produced. The editor phase must let users tune a page — text, images,
theme, section order — *without ever corrupting the schema*. The invariants
from earlier phases constrain the design:

1. **The envelope is the contract (ADR-0002).** Every persisted `PageVersion`
   must pass L1 structural validation; `Section.content` is an open object (no
   `additionalProperties`), but the semantic minima hold (hero title non-empty;
   a CTA within the first two content sections; the last section is the footer).
   L2 rules are advisory warnings, not rejections.
2. **Versions are immutable (ADR-0005 §10.2).** There is no update path and no
   `UPDATE` on `PageVersion`; a save = a **new row** with a bumped
   `versionNumber`, and concurrent saves are resolved by optimistic
   concurrency (`saveVersion({ baseVersion })` — exactly one wins).
3. **The engine stays the source for fresh content.** Regenerating a whole page
   from the brief already works; the new primitive is regenerating a *single
   section* so a user can re-roll just the hero, or a stale long section, in
   seconds.
4. **Sections must be addressable.** Regeneration needs a stable, content-free
   slot to target. The engine's stage 7 already runs on *layouts*; choosing one
   layout per section keeps the API shape (`{ type, variant, context }`) and
   saves a validation round-trip.

Constraints found while building it:

1. **The real hero slot is `media`, not `image`.** The engine's content
   generator emits `image: { assetRef, alt }` and the SchemaBuilder
   `_clean_hero` maps it to the canonical `media` slot that `ui-components`
   reads. Real persisted pages therefore use `media.assetRef` — the
   `tests/harness.ts` fixture's `headline/subheadline` keys are test-only and
   must never be treated as the real shape.
2. **Server-rendered previews can't host a live editor.** The editing surface is
   a `'use client'` `PageEditor`; the server page provides the latest version
   and mounts the editor with `key="v<versionNumber>"` so that SAVE and
   regeneration both `router.refresh()` into a **fresh editor** for the new
   version.
3. **Regeneration + draft edits are conflict-laden.** The regenerate API
   rebases on the *latest version*; an editor holding unsaved edits would be
   stale after the page regenerates. MVP trade-off: **regenerating a section
   saves a new version and discards unsaved local edits** — the editor is
   remounted and the user's local draft is dropped (accepted; see
   Consequences).
4. **The in-memory queue driver drains inside `add()`.** `enqueue.ts`
   originally wrote the record to the store *after* `add()` resolved; the
   memory driver's synchronous `drain()` starts the processor mid-`add`, whose
   `ensureRecord`/completion writes were then clobbered by the later QUEUED
   put — a job that had finished was "reset" to QUEUED and regen appeared to
   hang. Fixed by writing the record **before** `add()` and guarding `add`
   failure (`E-JOB-001`, FAILED).

## Decision

**A schema-level editor that edits the JSON envelope directly, validates every
save through the existing L1 validator, persists only as a new immutable draft
version, and re-rolls individual sections through the worker→engine pipeline.**

- **Editing unit:** the validated `PageVersion.content` envelope. The editor
  edits `sections[]` and `theme` generically (shape-driven), driven by the same
  register validators used at publish time. Any edit that fails L1 is rejected
  client-side with the validator's `{ path, message }` issues.
- **Draft lifecycle:** every accepted save calls
  `POST /api/v1/pages/:id/versions` (base = the version the editor loaded +
  did not mutate) → `saveVersion` optimistic concurrency → a **new immutable
  version**. A `409` (someone else saved first) surfaces as a "page changed,
  reload" prompt, never a lost write.
- **Section regeneration:** `POST /api/v1/pages/:id/regenerate` with
  `{ versionNumber, targetSectionId, mode: 'section' }` enqueues a
  `RegenerateJob` that (a) finds the target section in the target version,
  (b) re-runs the engine's layout plan for just that section with the brief
  context, and (c) on complete, persists a new L1-validated version whose
  non-target sections are byte-identical to the target version. A job is a
  normal worker ``generation-jobs`` row — same idempotency, status polling,
  `liveSync`, and error codes. **Failures never produce a half-edited page**:
  if the engine or validation fails, the page keeps the target version.
- **Theme & asset pickers** read `/api/v1/themes` (preset registry) and
  `/api/v1/assets` (stock media); both are owner-scoped reads behind
  `requireAuth`. The theme picker applies `{ preset, font, primaryColor,
  radius, density }` to the draft only.
- **Preview parity:** the editor renders the draft with the *same* renderer
  components the production preview uses, so "what you see" is the real page.

## Consequences

**Positive** — the DB never sees an invalid version (L1 gate at the API +
`saveVersion`); version immutability and 409-on-conflict give a crash-safe
multi-tab story; section regen reuses the entire proven pipeline (worker,
engine, liveSync, page_validation) and lands byte-stability for untouched
sections as a tested invariant; the generic editor needs no new per-section
forms; theme/assets reads ride the existing auth/CSRF/ownership plumbing.

**Trade-offs / notes** — regenerating discards unsaved local edits (MVP; a
dirty-merge reconciliation is future work); L2 rules are advisory, so the
editor shows them as warnings (e.g. a hero whose title is only one word still
saves); text slots are plain inputs with the same L0-ish length guards that
generation enforces, not a rich text editor; the editor ships client-side only
(no server-rendered editing), and there are **no component tests** (no
jsdom/testing-library rig) — the editor is verified by typecheck, `next build`,
and the existing API + e2e suites; dev-scale speed is fine because regen still
loads the full page context (acceptable while the engine is single-tenant).