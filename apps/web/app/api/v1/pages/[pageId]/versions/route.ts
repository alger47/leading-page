import { getPrismaClient, InvalidContentError, PagesRepository, OptimisticConcurrencyError } from '@landing-ai/database';
import { validateSemantic, validateStructural } from '@landing-ai/page-schema';
import type { NextRequest } from 'next/server';
import { ApiError, badRequest, jsonError, jsonOk, requireCsrf } from '@/lib/api';
import { requireAuth } from '@/lib/auth/context';
import { config } from '@/lib/env';

/**
 * POST /api/v1/pages/:pageId/versions
 * Persist an editor draft as a new immutable PageVersion (§10.2).
 * Validation gates (Phase 8 §8): L1 structural BLOCKS the save (422 E-VAL-L1);
 * L2 semantic issues are advisory warnings — the draft saves and the warnings
 * are returned so the UI can surface them (L2 blocks PUBLISH, not drafts).
 */

export async function POST(request: NextRequest, { params }: { params: { pageId: string } }) {
  try {
    const { owner } = await requireAuth(request);
    const cookieCsrf = request.cookies.get(config.csrfCookieName)?.value;
    requireCsrf(cookieCsrf, request.headers.get('x-csrf-token') ?? undefined);

    let body: { baseVersion?: unknown; schemaVersion?: unknown; content?: unknown };
    try {
      body = await request.json();
    } catch {
      throw badRequest('request body must be JSON');
    }
    const { baseVersion, schemaVersion, content } = body;
    if (typeof baseVersion !== 'number' || Number.isInteger(baseVersion) === false || baseVersion < 0) {
      throw badRequest('baseVersion must be a non-negative integer', 'E-VAL-REQ-001');
    }
    if (typeof schemaVersion !== 'string' || schemaVersion.trim() === '') {
      throw badRequest('schemaVersion is required', 'E-VAL-REQ-001');
    }
    if (typeof content !== 'object' || content === null || Array.isArray(content)) {
      throw badRequest('content must be a Page Schema object', 'E-VAL-REQ-001');
    }

    const pages = new PagesRepository(getPrismaClient());
    const owned = await pages.findOwnedPage(owner, params.pageId);
    if (!owned) throw new ApiError('page not found', 404, 'NOT_FOUND');

    // L1 gate: structural validity decides whether the draft may be persisted.
    const structural = validateStructural(content);
    if (!structural.valid) {
      throw new ApiError(
        'the document failed L1 structural validation',
        422,
        'E-VAL-L1',
        { issues: structural.errors },
      );
    }

    // L2 gate: advisory. The context when a semantic rule is violated.
    const semantic = validateSemantic(content);

    let version;
    try {
      version = await pages.saveVersion(owner, owned.projectId, owned.pageId, {
        baseVersion,
        schemaVersion,
        content,
      });
    } catch (error) {
      if (error instanceof InvalidContentError) {
        throw new ApiError(error.message, 422, 'E-VAL-L1');
      }
      if (error instanceof OptimisticConcurrencyError) {
        throw new ApiError('this draft is based on an outdated version; reload and retry', 409, 'OPTIMISTIC_CONCURRENCY');
      }
      throw error;
    }

    return jsonOk({ version: { versionNumber: version.versionNumber, schemaVersion }, warnings: semantic.warnings });
  } catch (error) {
    return jsonError(error);
  }
}