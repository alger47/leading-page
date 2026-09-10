import { getPrismaClient, PagesRepository } from '@landing-ai/database';
import type { NextRequest } from 'next/server';
import { ApiError, badRequest, jsonError, jsonOk, requireCsrf } from '@/lib/api';
import { requireAuth } from '@/lib/auth/context';
import { config } from '@/lib/env';
import { publishVersion, unpublishVersion } from '@/lib/publishing';

/**
 * POST /api/v1/pages/:pageId/publish  (Phase 10 — J5)
 * Validate → snapshot → subdomain. Publish a chosen immutable version (default:
 * the latest). Idempotent: republishing the same version keeps the same host
 * and returns the current state. Nothing invalid is ever published — the L1+L2
 * gate maps to 422 E-PUBLISH-001 with the failing issues.
 */
export async function POST(request: NextRequest, { params }: { params: { pageId: string } }) {
  try {
    const { owner } = await requireAuth(request);
    const cookieCsrf = request.cookies.get(config.csrfCookieName)?.value;
    requireCsrf(cookieCsrf, request.headers.get('x-csrf-token') ?? undefined);

    let body: { versionNumber?: unknown; subdomainId?: unknown };
    try {
      const text = await request.text();
      body = text.trim() ? (JSON.parse(text) as { versionNumber?: unknown; subdomainId?: unknown }) : {};
    } catch {
      throw badRequest('request body must be JSON');
    }

    const { versionNumber, subdomainId } = body ?? {};
    if (versionNumber !== undefined && (typeof versionNumber !== 'number' || !Number.isInteger(versionNumber) || versionNumber < 1)) {
      throw badRequest('versionNumber must be a positive integer', 'E-VAL-REQ-001');
    }
    if (subdomainId !== undefined && (typeof subdomainId !== 'string' || subdomainId.trim() === '')) {
      throw badRequest('subdomainId must be a non-empty string', 'E-VAL-REQ-001');
    }

    const pages = new PagesRepository(getPrismaClient());
    const owned = await pages.findOwnedPage(owner, params.pageId);
    if (!owned) throw new ApiError('page not found', 404, 'NOT_FOUND');

    const published = await publishVersion(owner, owned.projectId, owned.pageId, {
      versionNumber: versionNumber as number | undefined,
      subdomainId: subdomainId as string | null | undefined,
    });
    return jsonOk({ published }, 200);
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * DELETE /api/v1/pages/:pageId/publish
 * Idempotent downgrade-to-draft: the live page disappears, the snapshot and
 * the append-only event trail stay (unpublishedAt). Already-unpublished → 200.
 */
export async function DELETE(request: NextRequest, { params }: { params: { pageId: string } }) {
  try {
    const { owner } = await requireAuth(request);
    const cookieCsrf = request.cookies.get(config.csrfCookieName)?.value;
    requireCsrf(cookieCsrf, request.headers.get('x-csrf-token') ?? undefined);

    const pages = new PagesRepository(getPrismaClient());
    const owned = await pages.findOwnedPage(owner, params.pageId);
    if (!owned) throw new ApiError('page not found', 404, 'NOT_FOUND');

    const result = await unpublishVersion(owner, owned.projectId, owned.pageId);
    return jsonOk(result, 200);
  } catch (error) {
    return jsonError(error);
  }
}