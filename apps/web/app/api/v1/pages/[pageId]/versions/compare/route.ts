import { getPrismaClient, PagesRepository } from '@landing-ai/database';
import type { NextRequest } from 'next/server';
import { ApiError, badRequest, jsonError, jsonOk } from '@/lib/api';
import { requireAuth } from '@/lib/auth/context';
import { diffVersions } from '@/lib/versions-diff';

/**
 * GET /api/v1/pages/:pageId/versions/compare?from=:a&to=:b
 * Server-computed comparison of two immutable versions (Phase 9 — J4):
 * metadata changes + section diff summary (added/removed/changed/unchanged,
 * with `changedSlots` for changed sections). Safe to render; never mutates.
 */
export async function GET(request: NextRequest, { params }: { params: { pageId: string } }) {
  try {
    const { owner } = await requireAuth(request);
    const parse = (raw: string | null): number | null =>
      raw !== null && Number.isInteger(Number(raw)) && Number(raw) >= 1 ? Number(raw) : null;
    const from = parse(request.nextUrl.searchParams.get('from'));
    const to = parse(request.nextUrl.searchParams.get('to'));
    if (from === null || to === null) {
      throw badRequest('from and to must be positive integers', 'E-VAL-REQ-001');
    }

    const pages = new PagesRepository(getPrismaClient());
    const owned = await pages.findOwnedPage(owner, params.pageId);
    if (!owned) throw new ApiError('page not found', 404, 'NOT_FOUND');

    const a = await pages.versionAt(owner, owned.projectId, owned.pageId, from);
    const b = await pages.versionAt(owner, owned.projectId, owned.pageId, to);
    return jsonOk({ from: a.versionNumber, to: b.versionNumber, diff: diffVersions(a.contentJson, b.contentJson) });
  } catch (error) {
    return jsonError(error);
  }
}