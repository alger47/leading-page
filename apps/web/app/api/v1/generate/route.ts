import type { NextRequest } from 'next/server';
import { config } from '@/lib/env';
import { badRequest, invalid, jsonError, jsonOk, requireCsrf } from '@/lib/api';
import { buildGenerationService } from '@/lib/generation-service';
import { requireAuth } from '@/lib/auth/context';
import { isLocale, isTone, validateBriefInput } from '@/lib/validation';

export async function POST(request: NextRequest) {
  try {
    const { owner } = await requireAuth(request);
    const cookieCsrf = request.cookies.get(config.csrfCookieName)?.value;
    requireCsrf(cookieCsrf, request.headers.get('x-csrf-token') ?? undefined);

    const body = (await request.json().catch(() => null)) as {
      projectId?: unknown;
      pageId?: unknown;
      brief?: unknown;
      locale?: unknown;
      tone?: unknown;
    } | null;
    if (!body) return jsonError(badRequest('invalid JSON body'));

    if (typeof body.projectId !== 'string' || body.projectId === '') return jsonError(invalid('projectId is required'));
    if (typeof body.pageId !== 'string' || body.pageId === '') return jsonError(invalid('pageId is required'));

    const briefError = validateBriefInput(body.brief);
    if (briefError) return jsonError(invalid(briefError, 'E-VAL-BRIEF'));
    if (!isLocale(body.locale)) return jsonError(invalid('locale must be one of: ar, fr, en', 'E-VAL-BRIEF'));
    if (!isTone(body.tone)) return jsonError(invalid('tone is not in the supported list', 'E-VAL-BRIEF'));

    const clientKey = request.headers.get('idempotency-key') ?? undefined;
    const service = buildGenerationService();
    const result = await service.start({
      owner,
      projectId: body.projectId,
      pageId: body.pageId,
      brief: body.brief as string,
      locale: body.locale as 'ar' | 'fr' | 'en',
      tone: body.tone as string,
      clientIdempotencyKey: clientKey,
    });

    return jsonOk({ jobId: result.jobId, status: result.status }, result.created ? 202 : 200);
  } catch (error) {
    return jsonError(error);
  }
}