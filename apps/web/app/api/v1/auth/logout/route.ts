import { csrfCookieFlags, jsonError, jsonOk, requireCsrf, sessionCookieFlags } from '@/lib/api';
import { revokeSession } from '@/lib/auth/session';
import { requireAuth } from '@/lib/auth/context';
import { config } from '@/lib/env';
import type { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    await requireAuth(request);
    const cookieCsrf = request.cookies.get(config.csrfCookieName)?.value;
    requireCsrf(cookieCsrf, request.headers.get('x-csrf-token') ?? undefined);

    const sid = request.cookies.get(config.sessionCookieName)?.value;
    if (sid) await revokeSession(sid);

    const res = jsonOk({ ok: true });
    res.cookies.set(config.sessionCookieName, '', { ...sessionCookieFlags(config.secureCookies), maxAge: 0 });
    res.cookies.set(config.csrfCookieName, '', { ...csrfCookieFlags(config.secureCookies), maxAge: 0 });
    return res;
  } catch (error) {
    return jsonError(error);
  }
}