import { getPrismaClient, JobsRepository, PagesRepository } from '@landing-ai/database';
import type { NextRequest } from 'next/server';
import { ApiError, badRequest, jsonError, jsonOk, requireCsrf } from '@/lib/api';
import { requireAuth } from '@/lib/auth/context';
import { config } from '@/lib/env';
import { buildGenerationService, SectionNotFoundError } from '@/lib/generation-service';

/**
 * POST /api/v1/pages/:pageId/sections/:sectionId/regenerate
 * Phase 8 J2: enqueue a SECTION regeneration job for one section. The engine
 * rebuilds only that section's content over the current draft and the web
 * persists the returned (fully spliced) Page Schema as a new draft version.
 *
 * Regen context: the brief/locale/tone of the latest COMPLETED generation job
 * for this page, overridable per request; falls back to the page title when no
 * completed job exists yet.
 */

export async function POST(request: NextRequest, { params }: { params: { pageId: string; sectionId: string } }) {
  try {
    const { owner } = await requireAuth(request);
    const cookieCsrf = request.cookies.get(config.csrfCookieName)?.value;
    requireCsrf(cookieCsrf, request.headers.get('x-csrf-token') ?? undefined);

    let overrides: { brief?: unknown; locale?: unknown; tone?: unknown } = {};
    try {
      overrides = await request.json().catch(() => ({}));
    } catch {
      overrides = {};
    }

    const prisma = getPrismaClient();
    const pages = new PagesRepository(prisma);
    const owned = await pages.findOwnedPage(owner, params.pageId);
    if (!owned) throw new ApiError('page not found', 404, 'NOT_FOUND');

    const versions = await pages.listVersions(owner, owned.projectId, owned.pageId);
    const latest = versions[versions.length - 1];
    if (!latest) throw new ApiError('this page has no draft yet; generate a first version first', 409, 'NO_VERSION');

    const content = latest.contentJson as {
      schemaVersion?: string;
      page?: { title?: string; locale?: string };
    };
    const sections = (content as { sections?: Array<{ id?: string }> }).sections ?? [];
    if (!sections.some((s) => s.id === params.sectionId)) {
      throw new SectionNotFoundError(params.sectionId);
    }

    const engineJobs = await new JobsRepository(prisma).listByPage(owner, owned.projectId, owned.pageId);
    const lastCompleted = engineJobs.find((j) => j.status === 'COMPLETED');

    const brief = typeof overrides.brief === 'string' && overrides.brief.trim() !== '' ? overrides.brief.trim() : (lastCompleted?.brief ?? content.page?.title ?? '');
    const localeRaw = typeof overrides.locale === 'string' ? overrides.locale : (lastCompleted?.locale ?? content.page?.locale ?? 'en');
    const locale = localeRaw === 'ar' || localeRaw === 'fr' || localeRaw === 'en' ? localeRaw : 'en';
    const tone = typeof overrides.tone === 'string' && overrides.tone.trim() !== '' ? overrides.tone.trim() : (lastCompleted?.tone ?? 'warm-professional');

    if (brief.trim() === '') {
      throw badRequest('a regeneration needs a brief; provide one or generate the page first', 'E-VAL-REQ-001');
    }

    const service = buildGenerationService();
    const enqueued = await service.startSection({
      owner,
      projectId: owned.projectId,
      pageId: owned.pageId,
      targetSectionId: params.sectionId,
      page: content,
      baseVersion: latest.versionNumber,
      brief,
      locale,
      tone,
    });

    return jsonOk({ job: { jobId: enqueued.jobId, status: enqueued.status, created: enqueued.created } }, enqueued.created ? 202 : 200);
  } catch (error) {
    return jsonError(error);
  }
}