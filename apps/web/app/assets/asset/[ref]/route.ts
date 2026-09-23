import { getPrismaClient, GeneratedAssetsRepository } from '@landing-ai/database';
import { buildPlaceholderSvg } from '@/lib/assets';
import type { NextRequest } from 'next/server';

/**
 * Public resolution for logical `asset:` refs (Phase 16, review-fixed).
 *
 * The envelope stores LOGICAL refs (`asset:hero-saas`, §SEM-011) — the DB never
 * changes. This route is the PUBLIC boundary for generated images:
 *   1. bytes are served ONLY when the owning page is LIVE-published (a draft
 *      asset is never reachable here — ref-guessing buys nothing);
 *   2. any other ref renders the deterministic placeholder SVG so the CSP
 *      `img-src 'self'` baseline holds and no broken <img> appears.
 *
 * Cache honesty (§12.8): a logical ref may later resolve to real bytes, so the
 * placeholder is served with revalidation instead of `immutable` — browsers
 * never keep a stale placeholder past the short TTL.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { ref: string } },
) {
  const raw = params.ref;
  let ref: string;
  try {
    ref = decodeURIComponent(raw);
  } catch {
    ref = raw;
  }

  const repo = new GeneratedAssetsRepository(getPrismaClient());
  const stored = await repo.findPublicByRef(ref);
  if (stored !== null) {
    return new Response(new Blob([new Uint8Array(stored.bytes)], { type: stored.mime }), {
      status: 200,
      headers: {
        'Content-Type': stored.mime,
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
        'X-Content-Type-Options': 'nosniff',
        'Content-Length': String(stored.bytes.length),
      },
    });
  }

  const svg = buildPlaceholderSvg(ref);

  return new Response(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}