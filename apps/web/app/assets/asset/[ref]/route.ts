import { buildPlaceholderSvg, getRasterStore } from '@/lib/assets';
import type { NextRequest } from 'next/server';

/**
 * Resolution for logical `asset:` refs (Phase 16).
 *
 * The envelope stores LOGICAL refs (`asset:hero-saas`, §SEM-011) — the DB never
 * changes. On screen the renderer lowercases them to /assets/asset/{ref}. This
 * route serves, in order:
 *  1. the engine-generated raster the web relayed from the worker (in-memory,
 *     memory-first since the worker only caches briefly too), or
 *  2. the branded, deterministic placeholder SVG so the CSP `img-src 'self'`
 *     baseline holds and no broken <img> ever appears.
 * Bytes are ephemeral by design (free tier, no object store yet): after a
 * restart the same ref renders the placeholder again — honest, never broken.
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

  const stored = getRasterStore().get(ref);
  if (stored !== undefined) {
    return new Response(new Blob([new Uint8Array(stored.bytes)], { type: stored.mime }), {
      status: 200,
      headers: {
        'Content-Type': stored.mime,
        'Cache-Control': 'private, max-age=60',
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
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}