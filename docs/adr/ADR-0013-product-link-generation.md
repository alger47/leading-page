# ADR-0013: Product-Link Page Generation (reusing real product rasters) (Phase 16 part 2)

- **Status:** Accepted (2026-09-18, Phase 16)
- **Relates to:** ADR-0012 (image generation — the ephemeral asset flow is the
  reuse seam), ADR-0006 (web application); `docs/production-readiness.md`
  §product-source; `docs/api-reference.md` `POST /api/v1/product/extract`.

## Context

Phase 16 part 1 lets a fresh page carry **generated** raster art. For a
product-selling ad page (ADS-N/A, e.g. AliExpress-style), the *real product
photos* are more persuasive than anything FLUX can generate, and they cost
nothing. The user wants: paste a product URL → the app extracts the product
(title, price, bullets, photos) → pre-fills the brief → builds the page and
reuses those exact product rasters through the part-1 asset-ref plumbing
(`asset:hero`, `asset:feat-*`). No object store, no DB change, no persistence —
the same ephemeral-memory contract (ADR-0012 §2) applies to supplied rasters.

Constraints that shape the design:

1. **Server-side fetch only.** The product page is fetched by the web server,
   not the browser: keeps SSRF-relevant network egress server-side, allows a
   host allowlist, and avoids CORS/CSP issues on the client.
2. **Bounded, adversarial input.** The source HTML is untrusted third-party
   content; every extracted field is capped, every image URL is re-validated
   and only bytes matching sniffed image types are accepted.
3. **No schema/DB change.** Supplied rasters ride the same manifest/ref contract
   from ADR-0012 (`asset:<requirement id>`, refs only in DB, bytes in memory).
4. **Free-tier friendly.** A product link may be *optional*; when fetch/parse
   fails the flow degrades to the existing manual-brief path with an explicit
   error (`E-PROD-001`).

## Decision

**1. Web server performs a bounded product fetch.**
`POST /api/v1/generate` accepts an optional `productUrl`. A new
`app/api/v1/product/extract/route.ts` exposes the parse-only step
(`POST /api/v1/product/extract`) for the UI live-preview. Implementation
(`lib/product-source.ts`):
- Host **allowlist** via env `PRODUCT_SOURCE_ALLOWLIST` (comma-separated
  glob-ish suffixes; default `aliexpress.com`; `localhost`/`127.0.0.1` allowed
  only in tests by env override). `assertSafeUrl` rejects anything not in the
  allowlist (`E-PROD-001`, 400); scheme must be http/https (blocking
  `file:`/`data:`/non-http SSRF).
- The document is read with a **2 MiB cap** (`readBounded`); images are
  downloaded with a **1 MiB cap** (skipped on oversize — the image is dropped,
  not the job), max **4 images**, 2s per-image timeout.
- The **mime is sniffed from bytes** (PNG/JPEG/WebP/GIF/AVIF signatures), never
  trusted from headers; the response `content-type` must agree with the sniffed
  one or the asset is rejected (Image-Prober hole hardening). PROGM-QA note: this
  is the no-Doppelbyte rule for product assets.

**2. Extraction is layered and loss-tolerant** (`lib/product-extract.ts`):
- **Layer 1 — JSON walk** (`runParams`-style `window.*` globals): recursive walk
  of the first parseable marked-JSON blob, collecting titles, prices, bullets
  and images under known key patterns (`IMAGE_KEYS`, `BULLET_KEYS` …).
- **Layer 2 — regex fallbacks** for product-list JSON on the page (`imagePathList`
  arrays, `price`, `subject` pairs) and Open-Graph meta tags.
- Fields are **capped and deduped**: title ≤ 120 chars, price normalized to
  digits/decimal, bullets ≤ 8 × 300 chars, images **absolutized against the
  page URL, de-duplicated, kept ≤ 8**, and every kept URL must still resolve as
  an http(s) URL that `looksLikeImageUrl` agrees on.
- Empty-but-successful extraction → `EMPTY_PRODUCT` → the UI shows the manual
  brief path with a hint; it is never a 500.

**3. Supplied rasters reuse the ADR-0012 asset flow end-to-end.**
Web `generate`/`extract` build `suppliedImages: [{ref, mime, data_b64}]`
(server-side download). The worker `POST_JOB_SCHEMA` accepts `suppliedImages`
(maxItems 4, data_b64 ≤ 1 600 000 chars, refs ≤ 256 chars, mime enum) and mints
the idempotency **fingerprint** over `count + sorted refs` (bytes never hash
the same job differently across retries). The engine `POST /internal/v1/generate`
accepts `supplied_images` (Pydantic model, base64 is **decoded and validated**
server-side, max_length 8) and passes them into the asset-renderer.
Inside `AssetRenderer.render(..., supplied=...)` supplied rasters are consumed
**in order, one per requirement** (hero first), stored verbatim with
`model_class="supplied"`, `prompt_ref="supplied@product"`, `provider="product"`,
**zero cost**; an oversized supplied image becomes the existing warning issue
`E-IMG-001` + placeholder (never a fabricated success); once the queue is empty
the remaining requirements fall back to FLUX generation exactly as in part 1.

**4. Failure is explicit and degrades gracefully.**
Any failure in fetch/allowlist/parse/download surfaces as `E-PROD-001` (400)
with a user-readable message; the UI keeps the manual brief editable and only
the product-link section shows the error. Success pre-fills the brief input
with the extracted title + bullets and renders small per-image thumbnails.

## Consequences

**Positive** — a pasted link produces a page built on the *real* product
photos with zero image-generation cost; the manual brief remains fully
available; extraction is bounded end-to-end (2 MiB doc / 1 MiB image / 4
images) so a hostile page cannot abuse the server fetch; everything stays
free-tier and schema/DB-shaped as before.

**Trade-offs / notes** — extraction is heuristic: messy pages degrade to
`EMPTY_PRODUCT` + manual brief rather than to a fake parse; supplied rasters
obey the same ephemerality as generated ones (lost on restart, refs only in
DB); product-source download egress is allowlist-gated but still internet
egress from the web service (documented in `production-readiness.md` §10);
`PRODUCT_SOURCE_ALLOWLIST` is a dev/test override — production keeps the
AliExpress-only default.