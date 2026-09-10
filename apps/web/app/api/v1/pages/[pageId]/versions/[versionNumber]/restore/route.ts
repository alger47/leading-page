import { getPrismaClient, OptimisticConcurrencyError, PagesRepository } from '@landing-ai/database';
import type { NextRequest } from 'next/server';
import { ApiError, badRequest, jsonError, jsonOk, requireCsrf } from '@/lib/api';
import { requireAuth } from '@/lib/auth/context';
import { config } from '@/lib/env';

/**
 * POST /api/v1/pages/:pageId/versions/:versionNumber/restore
 * Restore a previous version (Phase 9 — J4): the target's immutable snapshot
 * becomes a NEW latest version (§10.2 — restore copies, it never rewrites).
 * The snapshot goes through the same L1 gate as any draft save.
 */
export async function POST(request: NextRequest, { params }: { params: { pageId: string; versionNumber: string } }) {
  try {
    const { owner } = await requireAuth(request);
    const cookieCsrf = request.cookies.get(config.csrfCookieName)?.value;
    requireCsrf(cookieCsrf, request.headers.get('x-csrf-token') ?? undefined);

    const versionNumber = Number(params.versionNumber);
    if (!Number.isInteger(versionNumber) || versionNumber < 1) {
      throw badRequest('versionNumber must be a positive integer', 'E-VAL-REQ-001');
    }

    const pages = new PagesRepository(getPrismaClient());
    const owned = await pages.findOwnedPage(owner, params.pageId);
    if (!owned) throw new ApiError('page not found', 404, 'NOT_FOUND');

    const target = await pages.versionAt(owner, owned.projectId, owned.pageId, versionNumber);
    const versions = await pages.listVersions(owner, owned.projectId, owned.pageId);
    const latestNumber = versions.length > 0 ? (versions[versions.length - 1].versionNumber as number) : 0;

    try {
      const restored = await pages.saveVersion(owner, owned.projectId, owned.pageId, {
        baseVersion: latestNumber,
        schemaVersion: target.schemaVersion,
        content: target.contentJson,
      });
      return jsonOk({
        version: { versionNumber: restored.versionNumber, restoredFrom: target.versionNumber },
      });
    } catch (error) {
      if (error instanceof OptimisticConcurrencyError) {
        throw new ApiError('the page changed while restoring; reload and retry', 409, 'OPTIMISTIC_CONCURRENCY');
      }
      throw error;
    }
  } catch (error) {
    return jsonError(error);
  }
}