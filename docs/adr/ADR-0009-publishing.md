# ADR-0009: Publishing — Gate, Snapshot, Subdomain & Public Route (J5)

- **Status:** Accepted (2026-09-10, publishing phase)
- **Relates to:** ADR-0005 §10.2 (immutable versions), ADR-0008 (publishing a
  *selected* version is owned here), master catalog "PHASE 10 — Publishing".

## Context

J5 wants: validate → snapshot PublishedPage → subdomain → cache · unpublish ·
draft/published separation · noindex on drafts, and the acceptance adds hard
constraints — an invalid schema must never be publishable (gate test), and a
published page must ship **zero dashboard/editor JS**, with performance budgets
measured (~90 KB gzipped).

Anchors already in place:

1. **Versions are immutable** (`PageVersion`, ADR-0005 §10.2), validated L1 on
   write. A publish target is one immutable version, never a live draft.
2. **Two-tier validation exists** (page-schema): L1 structural (blocks save
   corruption) and L2 semantic (`SEM-001..004`, advisory as draft warnings).
3. **React context cannot be used in Server Components** — the `react-server`
   webpack build strips `createContext`, so `next build` fails with
   `TypeError: i(...).createContext is not a function` when a page module uses
   `React.useContext`. The shared `ui-components` renderer depends on
   `ThemeProvider` context, so it cannot be a Server Component.
4. **`react-dom/server` is banned in modules a page imports** ("You're
   importing a component that imports react-dom/server…"), so SSR of the
   renderer must live in code the app pages never import (tests/route helpers).

## Decision

**Publish = immutable-version snapshot + a subdomain + a public route.**

- **Gate (§5 , §8, §11):** publishing requires **L1 structural AND L2 semantic
  to pass** (L2 *warnings* are fine; L2 *errors* block). One confirmation
  route owns it (`lib/publishing.ts`). The two-tier rule is deliberate: drafts
  may save with L2 errors (save gate is L1-only) but a *published* page must
  be "clean". Violations → `422 E-PUBLISH-001` with `details.issues` from the
  L2 validator. Invalid schemas can never publish.
- **Snapshot, not pointer, at the schema level:** publishing copies the chosen
  immutable version's `content` into a dedicated `PublishedPage` row
  (immutable snapshot) and points `Page.subdomain` at it. The page keeps its
  attached subdomain — republishing a newer version moves the pointer
  (idempotent; the host stays stable), unpublishing detaches it.
- **Host resolution:** `p-<pageId-last-12>.<PUBLIC_HOST_SUFFIX>` (default
  suffix `landing-ai.test`); the public URL is
  `${PUBLIC_BASE_URL}/${host}` (default base `http://localhost:3000`). Both in
  `lib/env.ts` config. The subdomain row is reserved before any publish and is
  never reused by another page.
- **Public route:** `app/(published)/[host]/page.tsx` is a **server** page
  (data + `generateMetadata`, indexable, `notFound()` when unpublished). The
  snapshot renders through a single allowed client shell
  (`components/published-page.tsx`, `'use client'`, imports **only**
  `@landing-ai/ui-components`) because the renderer uses React context (see
  Context #3). The dashboard layout is noindex (`metadata.robots index:false`)
  — drafts and private pages stay out of search engines.
- **Unpublish:** idempotent `DELETE`; detaches the subdomain (published flag
  cleared) and the public route 404s.
- **Performance budget (§5.7):** measured — not aspirational. `pnpm
  test:budget` (after `next build`) sums the **gzipped** client JS a published
  page actually fetches (`webpack-runtime + framework + main-app + the shared
  `main` entry (which carries the public renderer) + the `[host]` page chunk`)
  and asserts ≤ 90 KB; legacy `polyfills` are reported separately
  (browser-conditional). Isolation is verified two ways: the triggered
  `<Render/>` SSR path stays out of dashboard imports, and the built
  `(published)/[host]/page.js` server bundle must not reference any
  dashboard/editor marker.

## Consequences

**Positive** — the gate is one auditable choke point shared by API/e2e tests;
publishing a snapshot keeps history untouched (unpublish/republish moves the
pointer, all versions intact and verifiable); the public route is deliberately
tiny, and the budget tool makes §5.7 regression-proof (measured **79.5 KB**
gzipped at Phase 10, isolation OK).

**Trade-offs / notes** — the public shell is client-side because the shared
renderer uses React context; the "zero dashboard/editor JS" guarantee is the
absence of dashboard/editor modules from the published bundle (verified in the
build output + at test time), not a *zero-JS* page. Hosts are derived from the
page id, so a republished URL is stable across edits/unpublishes; real DNS
mapping to `PRIMARY_DOMAIN` is a production-ops concern, not part of this
phase's dev demo (base `http://localhost:3000`). `react-dom/server` rendering
of snapshots stays in test helpers only — Next forbids it in page-imported
modules by design.