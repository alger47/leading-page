import { getPrismaClient, PagesRepository } from '@landing-ai/database';
import type { NextRequest } from 'next/server';
import { ApiError, badRequest, jsonError, jsonOk } from '@/lib/api';
import { requireAuth } from '@/lib/auth/context';

/**
 * GET /api/v1/pages/:pageId/versions/:versionNumber
 * Full immutable version snapshot (Phase 9 — J4): metadata + content. Used by
 * the version compare and by previewing a specific history entry.
 */
export async function GET(request: NextRequest, { params }: { params: { pageId: string; versionNumber: string } }) {
  try {
    const { owner } = await requireAuth(request);
    const versionNumber = Number(params.versionNumber);
    if (!Number.isInteger(versionNumber) || versionNumber < 1) {
      throw badRequest('versionNumber must be a positive integer', 'E-VAL-REQ-001');
    }
    const pages = new PagesRepository(getPrismaClient());
    const owned = await pages.findOwnedPage(owner, params.pageId);
    if (!owned) throw new ApiError('page not found', 404, 'NOT_FOUND');

    const version = await pages.versionAt(owner, owned.projectId, owned.pageId, versionNumber);
    return jsonOk({
      version: {
        versionNumber: version.versionNumber,
        schemaVersion: version.schemaVersion,
        createdAt: version.createdAt.toISOString(),
        createdBy: version.createdBy,
        content: version.contentJson,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}