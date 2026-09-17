# Security Annex — PART XII §12.1 Threat Matrix

This document records every threat identified during the PART XII audit,
the mitigations implemented, and how they are verified (code path + test).

---

## §12.1 — Threat Matrix

| Threat (§12.1) | Mitigation | Code | Verification |
|---|---|---|---|
| **IDOR — cross-tenant resource access** | Every API route resolves ownership via `pages.findOwnedPage(owner, pageId)` or the equivalent repository call (keyed to `Owner.userId`), then throws 404 (not 403) if the resource is not owned. `GenerationService.start()` chains `projects.get` → `pages.get` before any work is queued. | `apps/web/app/api/v1/pages/*/route.ts`, `packages/database/src/repositories/pages.ts:findOwnedPage`, `apps/web/lib/generation-service.ts:120-121` | `tests/security.integration.test.ts` — cross-tenant 404 across GET page, GET versions, POST versions, POST publish, DELETE publish, POST regenerate, POST create-page-under-foreign-project, GET job, DELETE job, POST generate. |
| **CSRF — state mutation without token** | Every mutating endpoint calls `requireCsrf()` before touching the DB; the client carries a SameSite=strict session cookie and a js-readable CSRF cookie; the `x-csrf-token` header must match on every POST/PUT/PATCH/DELETE. | `apps/web/lib/auth/csrf.ts` (`generateCsrfToken`, `compareCsrfTokens`); `apps/web/lib/api.ts` (`requireCsrf`); enforced in every `POST`/`DELETE` route. | `tests/api.integration.test.ts` (bogus token → 403 on `/generate`); `tests/security.integration.test.ts` — 403 matrix across 9 mutation endpoints. |
| **XSS — hostile `href` / `url` reaching the renderer** | Two layers: **L1** (`validateStructural`) walks every `href`/`url` in sections, assets, and `seo.canonical` through `isSafeHref`; any `javascript:`/`data:`/`vbscript:` target or control-character smuggling is rejected at save/publish time (`E-VAL-STRUCT-004`). **Renderer** (`Button`, `Header`, `Footer`) applies `sanitizeHref` (hostile → inert `#`) as a second line of defense. | `packages/page-schema/src/schemes.ts` (`isSafeHref`, `sanitizeHref`); `packages/page-schema/src/validators/structural.ts` (`validateHrefSchemes`); `packages/ui-components/src/primitives/Button.tsx`, `src/sections/Header.tsx`, `src/sections/Footer.tsx` | `packages/page-schema/tests/schemes.test.ts` (scheme allowlist + smuggling); `packages/page-schema/tests/structural.test.ts` (E-VAL-STRUCT-004 for hostile content + assets); `packages/ui-components/tests/renderer-guard.test.tsx`. |
| **XSS — SVG placeholder label injection** | `buildPlaceholderSvg` escapes `& < > " '` in the ref-derived label; control characters are dropped. | `apps/web/lib/assets.ts` | `apps/web/tests/assets.test.ts` (hostile ref with `<script>` + entities → escaped, no breakout). |
| **Secret disclosure — `healthz` endpoint** | `envProbe` block removed (no `NODE_ENV`, no `presentKeysInProcess` in PID-1, no token presence). | `apps/web/app/api/v1/healthz/route.ts` | `tests/security.integration.test.ts` (200 + no `envProbe`/`nodeEnv` keys + no token in body). |
| **Secrets in CI / repo history** | `gitleaks` job on every push and PR (`fetch-depth: 0` full history scan). | `.github/workflows/ci.yml` (`secret-scan` job) | CI pipeline; run locally: `gitleaks detect --source . --no-banner` |
| **Stored XSS / hosting abuse via uploads** | `Storage.put` (local + S3) accepts only `image/png/jpeg/gif/webp/avif/svg+xml`; anything else throws. | `apps/web/lib/storage.ts` (`assertAllowedContentType`) | `apps/web/tests/storage.test.ts` (text/html, text/plain, application/json → "not allowed"). |
| **Fail-open internal tokens in production** | Worker: `assertProdConfig()` refuses to boot when `WORKER_INTERNAL_TOKEN` or `AI_INTERNAL_TOKEN` equals the dev default under `NODE_ENV=production`. Web: `GenerationService` constructor throws per-request in production when `workerToken` is the dev default (guard at the request boundary, not in `webConfig()` which also runs during `next build`). | `apps/worker/src/config.ts` (`assertProdConfig`), `apps/worker/src/index.ts`; `apps/web/lib/generation-service.ts:114-118`, `apps/web/lib/env.ts` (`DEV_WORKER_TOKEN`) | `apps/worker/tests/config.test.ts` (5 cases); `apps/web/tests/prod-guard.test.ts` (3 cases). |
| **CSP / framing / origin isolation** | COOP/CORP/OAC headers added; CSP locks `frame-ancestors`, `base-uri`, `form-action` to `'self'`; `unsafe-inline`/`unsafe-eval` retained for Next hydration bootstrap (justification documented in `next.config.mjs`). | `apps/web/next.config.mjs` | `apps/web/tests/security-headers.test.ts` (COOP/CORP/OAC + CSP assertions). |

---

## Residual Risks

The following items remain as known risks to be addressed before any public deployment (Phase 15 scope):

1. **Groq API key in `apps/ai-engine/.env`** — the key is committed to the local repo's `.env` and must be **rotated** before any public/CI deploy. A leaked key grants unpaid LLM access.
2. **CSP `unsafe-inline` / `unsafe-eval`** — currently required by Next.js hydration (inline bootstrap scripts). The XSS surface they leave is closed by the L1 href gate + renderer guard + SVG escaping today; a future Next upgrade may offer a nonce-based path and these can be tightened.
3. **Engine input provenance** — the worker echoes the user-provided brief into the AI engine prompt; prompt-injection hardening (input sanitization / output filtering) is a Phase 15 item flagged in `docs/security.md`.
4. **`POST /api/v1/projects/{id}/pages` and `POST /api/v1/generate` body validation order** — these routes currently return 400/422 for malformed payloads *before* the ownership check, meaning an attacker can learn whether a projectId/pageId exists by observing 400 vs 404. This does not leak *content* and the resource is not exploitable, but the ordering should ideally be ownership-first in a future hardening pass. (The versions/publish/unpublish/restore/regenerate routes correctly check ownership first.)
