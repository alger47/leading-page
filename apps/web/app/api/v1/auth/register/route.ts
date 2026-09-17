import { getPrismaClient, UsersRepository } from '@landing-ai/database';
import { hashPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import { generateCsrfToken } from '@/lib/auth/csrf';
import { config } from '@/lib/env';
import { attachSessionCookie, badRequest, csrfCookieFlags, invalid, jsonError, jsonOk } from '@/lib/api';
import { validateEmail, validateName, validatePassword } from '@/lib/validation';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    email?: unknown;
    name?: unknown;
    password?: unknown;
  } | null;
  if (!body) return jsonError(badRequest('invalid JSON body'));

  const emailError = validateEmail(body.email);
  const passwordError = validatePassword(body.password);
  const nameError = validateName(body.name);
  if (emailError) return jsonError(invalid(emailError));
  if (passwordError) return jsonError(invalid(passwordError));
  if (nameError) return jsonError(invalid(nameError));

  const email = (body.email as string).trim().toLowerCase();
  const name = (body.name as string | undefined)?.trim() || null;

  try {
    const repo = new UsersRepository(getPrismaClient());
    const user = await repo.create({ email, name, passwordHash: await hashPassword(body.password as string) });

    const token = await createSession(user.id);
    const csrf = generateCsrfToken();
    const res = jsonOk({ user: { id: user.id, email: user.email, name: user.name } }, 201);
    attachSessionCookie(res, token, config.sessionTtlMs);
    res.cookies.set(config.csrfCookieName, csrf, {
      ...csrfCookieFlags(config.secureCookies),
      expires: new Date(Date.now() + config.sessionTtlMs),
    });
    return res;
  } catch (error) {
    return jsonError(error);
  }
}