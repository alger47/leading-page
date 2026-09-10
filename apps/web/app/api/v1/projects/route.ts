import { config } from '@/lib/env';
import { badRequest, invalid, jsonError, jsonOk, requireCsrf } from '@/lib/api';
import { createProjectView, listProjectsView } from '@/lib/data';
import { requireAuth } from '@/lib/auth/context';
import { validateName } from '@/lib/validation';
import type { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { owner } = await requireAuth(request);
    const projects = await listProjectsView(owner);
    return jsonOk({ projects });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { owner } = await requireAuth(request);
    const cookieCsrf = request.cookies.get(config.csrfCookieName)?.value;
    requireCsrf(cookieCsrf, request.headers.get('x-csrf-token') ?? undefined);

    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
      defaultLocale?: unknown;
      tone?: unknown;
    } | null;
    if (!body) return jsonError(badRequest('invalid JSON body'));
    const nameError = validateName(body.name);
    if (nameError) return jsonError(invalid(nameError));
    const name = (body.name as string | undefined)?.trim();
    if (!name) return jsonError(invalid('name is required'));

    const localeError = body.defaultLocale != null && ![null, 'ar', 'fr', 'en'].includes(body.defaultLocale as string)
      ? 'defaultLocale must be one of: ar, fr, en'
      : null;
    if (localeError) return jsonError(invalid(localeError));

    const toneError = body.tone != null && !['warm-professional', 'cool-modern', 'bold-creative', 'minimal-clean', 'playful', 'luxury', 'bold-minimal'].includes(body.tone as string)
      ? 'tone is not in the supported list'
      : null;
    if (toneError) return jsonError(invalid(toneError));

    const project = await createProjectView(owner, {
      name,
      defaultLocale: body.defaultLocale == null ? null : (body.defaultLocale as string),
      tone: body.tone == null ? null : (body.tone as string),
    });
    return jsonOk({ project }, 201);
  } catch (error) {
    return jsonError(error);
  }
}