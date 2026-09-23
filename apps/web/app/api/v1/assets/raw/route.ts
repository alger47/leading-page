import { GeneratedAssetsRepository, getPrismaClient } from '@landing-ai/database';
import type { NextRequest } from 'next/server';
import { ApiError, badRequest, jsonError } from '@/lib/api';
import { requireAuth } from '@/lib/auth/context';

/**
 * GET /api/v1/assets/raw?ref=...&pageId=... — authenticated draft-asset proxy.
 *
 * The dashboard preview renders draft content whose `asset:` refs must resolve
 * to the bytes of the CURRENT user's own page — without making draft rasters
 * reachable through the public /assets/asset/[ref] route (review P0: draft
 * isolation, §10.5). Resolution requires BOTH components:
 *   - pageId (the preview's own page, already owned via session), and
 *   - ref   (no global ref → data mapping).
 */
export async function GET(request: NextRequest) {
  try {
    const { owner } = await requireAuth(request);
    const pageId = request.nextUrl.searchParams.get('pageId') ?? '';
    const ref = request.nextUrl.searchParams.get('ref') ?? '';
    if (!pageId || !ref.startsWith('asset:')) {
      throw badRequest('pageId and an asset: ref are required', 'E-VAL-REQ-001');
    }

    const repo = new GeneratedAssetsRepository(getPrismaClient());
    const asset = await repo.getOwnedByRefForPage(owner, pageId, ref);
    if (!asset) throw new ApiError('asset not found', 404, 'NOT_FOUND');

    return new Response(new Blob([new Uint8Array(asset.bytes)], { type: asset.mime }), {
      status: 200,
      headers: {
        'Content-Type': asset.mime,
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        'Content-Length': String(asset.bytes.length),
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}