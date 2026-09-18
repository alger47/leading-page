/**
 * API edge helpers: stable §11.2 error envelope, JSON responses, session
 * cookie set/clear, and the CSRF double-submit guard for mutating routes.
 */

import { NextResponse } from 'next/server';
import {
  ConflictError,
  InvalidContentError,
  NotFoundError,
  OptimisticConcurrencyError,
  RepositoryError,
  StateTransitionError,
} from '@landing-ai/database';
import { WorkerCallError } from './worker-client';
import { GenerationInputError, SectionNotFoundError } from './generation-service';
import { ProductSourceError } from './product-source';
import { CSRF_COOKIE, csrfTokensMatch } from './auth/csrf';
import { config } from './env';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(message: string, status: number, code: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** 400: malformed request (bad JSON, missing id, …). */
export const badRequest = (message: string, code = 'E-REQ-000'): ApiError => new ApiError(message, 400, code);

/** 422: a field failed semantic validation (§11.2). */
export const invalid = (message: string, code = 'E-VAL-000'): ApiError => new ApiError(message, 422, code);

const notFound = 'NOT_FOUND';

export function statusAndCodeFor(error: unknown): { status: number; code: string } {
  if (error instanceof ApiError) return { status: error.status, code: error.code };
  if (error instanceof NotFoundError) return { status: 404, code: notFound };
  if (error instanceof ConflictError) return { status: 409, code: 'CONFLICT' };
  if (error instanceof OptimisticConcurrencyError) return { status: 409, code: 'OPTIMISTIC_CONCURRENCY' };
  if (error instanceof InvalidContentError) return { status: 422, code: 'INVALID_CONTENT' };
  if (error instanceof StateTransitionError) return { status: 409, code: 'STATE_TRANSITION' };
  if (error instanceof RepositoryError) return { status: 500, code: error.code };
  if (error instanceof WorkerCallError) return { status: error.status, code: error.code };
  if (error instanceof GenerationInputError) return { status: 422, code: error.code };
  if (error instanceof SectionNotFoundError) return { status: 404, code: error.code };
  if (error instanceof ProductSourceError) return { status: 400, code: error.code };
  return { status: 500, code: 'E-INTERNAL-001' };
}

export function errorEnvelope(error: unknown): Record<string, unknown> {
  const { code } = statusAndCodeFor(error);
  const message = error instanceof Error ? error.message : 'unexpected server error';
  const details = error instanceof ApiError ? error.details : undefined;
  return {
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
      docs: `/docs/errors/${code}`,
    },
  };
}

export const jsonOk = (data: unknown, status = 200): NextResponse => NextResponse.json(data, { status });

export const jsonError = (error: unknown): NextResponse => {
  const { status } = statusAndCodeFor(error);
  // 500 responses must not leak internals.
  const safe = status >= 500
    ? { error: { code: 'E-INTERNAL-001', message: 'An unexpected error occurred.', docs: '/docs/errors/E-INTERNAL-001' } }
    : errorEnvelope(error);
  return NextResponse.json(safe, { status });
};

// ------------------------------------------------------------------- cookies

export const SESSION_COOKIE = config.sessionCookieName;

/**
 * Cookie flag policy (Phase 15). One place decides HttpOnly/SameSite/Secure so
 * session, CSRF and clear paths can never drift. `secure` is true in production
 * (or when COOKIE_SECURE overrides); the CSRF cookie is intentionally readable
 * by JS for the double-submit header.
 */
export interface CookieFlags {
  httpOnly: boolean;
  sameSite: 'strict';
  secure: boolean;
  path: string;
}

export const sessionCookieFlags = (secure: boolean): CookieFlags => ({
  httpOnly: true,
  sameSite: 'strict',
  secure,
  path: '/',
});

export const csrfCookieFlags = (secure: boolean): CookieFlags => ({
  httpOnly: false,
  sameSite: 'strict',
  secure,
  path: '/',
});

export function attachSessionCookie(
  res: NextResponse,
  token: string,
  ttlMs: number,
  secure: boolean = config.secureCookies,
): NextResponse {
  res.cookies.set(SESSION_COOKIE, token, {
    ...sessionCookieFlags(secure),
    expires: new Date(Date.now() + ttlMs),
  });
  return res;
}

export function clearSessionCookie(res: NextResponse, secure: boolean = config.secureCookies): NextResponse {
  res.cookies.set(SESSION_COOKIE, '', { ...sessionCookieFlags(secure), maxAge: 0 });
  return res;
}

// ------------------------------------------------------------------- csrf

export function requireCsrf(cookieValue: string | undefined, headerValue: string | undefined): void {
  if (!csrfTokensMatch(cookieValue, headerValue)) {
    throw new ApiError('CSRF token missing or invalid', 403, 'E-CSRF-001');
  }
}

export const CSRF_COOKIE_NAME = CSRF_COOKIE;