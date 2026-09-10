import { config } from '@/lib/env';
import { badRequest, invalid, jsonError, jsonOk, requireCsrf } from '@/lib/api';
import { createPageView, listPagesView } from '@/lib/data';
import { requireAuth } from '@/lib/auth/context';
import { validateName } from '@/lib/validation';
import type { NextRequest } from 'next/server';

export async function GET(request: NextRequest, { params }: { params: { projectId: string } }) {
  try {
    const { owner } = await requireAuth(request);
    const pages = await listPagesView(owner, params.projectId);
    return jsonOk({ pages });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: { projectId: string } }) {
  try {
    const { owner } = await requireAuth(request);
    const cookieCsrf = request.cookies.get(config.csrfCookieName)?.value;
    requireCsrf(cookieCsrf, request.headers.get('x-csrf-token') ?? undefined);

    const body = (await request.json().catch(() => null)) as { title?: unknown; locale?: unknown } | null;
    if (!body) return jsonError(badRequest('invalid JSON body'));
    const titleError = validateName(body.title);
    if (titleError) return jsonError(invalid(titleError));
    const title = (body.title as string | undefined)?.trim();
    if (!title) return jsonError(invalid('title is required'));

    const locale = body.locale == null ? null : (body.locale as string);
    if (locale != null && !['ar', 'fr', 'en'].includes(locale)) {
      return jsonError(invalid('locale must be one of: ar, fr, en'));
    }

    const page = await createPageView(owner, params.projectId, { title, locale });
    return jsonOk({ page }, 201);
  } catch (error) {
    return jsonError(error);
  }
}