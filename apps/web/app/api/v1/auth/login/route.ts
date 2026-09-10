import { getPrismaClient, UsersRepository } from '@landing-ai/database';
import { verifyPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import { generateCsrfToken } from '@/lib/auth/csrf';
import { config } from '@/lib/env';
import { ApiError, attachSessionCookie, badRequest, invalid, jsonError, jsonOk } from '@/lib/api';
import { validateEmail, validatePassword } from '@/lib/validation';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
  if (!body) return jsonError(badRequest('invalid JSON body'));

  const emailError = validateEmail(body.email);
  const passwordError = validatePassword(body.password);
  if (emailError) return jsonError(invalid(emailError));
  if (passwordError) return jsonError(invalid(passwordError));

  const email = (body.email as string).trim().toLowerCase();
  try {
    const repo = new UsersRepository(getPrismaClient());
    const user = await repo.getByEmail(email);
    if (!user?.passwordHash) {
      return jsonError(new ApiError('invalid email or password', 401, 'E-AUTH-002'));
    }
    const ok = await verifyPassword(body.password as string, user.passwordHash);
    if (!ok) return jsonError(new ApiError('invalid email or password', 401, 'E-AUTH-002'));

    const token = await createSession(user.id);
    const csrf = generateCsrfToken();
    const res = jsonOk({ user: { id: user.id, email: user.email, name: user.name } });
    attachSessionCookie(res, token, config.sessionTtlMs);
    res.cookies.set(config.csrfCookieName, csrf, {
      httpOnly: false,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: new Date(Date.now() + config.sessionTtlMs),
    });
    return res;
  } catch (error) {
    return jsonError(error);
  }
}