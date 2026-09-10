import { buildPlaceholderSvg } from '@/lib/assets';
import type { NextRequest } from 'next/server';

/**
 * Self-hosted deterministic placeholder for logical `asset:` refs.
 *
 * The renderer never shows an `asset:` scheme on screen: every ref lowers to
 * /assets/asset/{ref}. This route serves a branded, deterministic SVG so the
 * CSP `img-src 'self'` baseline holds, the broken-image flicker disappears,
 * and ADS-N/A user understand what's pending (they replace it via the editor
 * asset picker / S3 uploads). Pure function of the ref — cacheable forever.
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