/**
 * CSRF double-submit (master prompt §12.1: CSRF tokens on mutating routes).
 * A `csrf` cookie (not httpOnly) carries the token; every mutating API call
 * must echo it in the `x-csrf-token` header. SameSite=strict cookies already
 * blunt classic CSRF; this adds the spec-required second line for JSON APIs.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const CSRF_COOKIE = 'csrf';

export function generateCsrfToken(): string {
  return randomBytes(24).toString('hex');
}

function digest(token: string): string {
  // Constant-time compare against a hash, never the raw value.
  return createHash('sha256').update(token).digest('hex');
}

export function csrfTokensMatch(cookieValue: string | undefined, headerValue: string | undefined): boolean {
  if (!cookieValue || !headerValue) return false;
  const a = Buffer.from(digest(cookieValue));
  const b = Buffer.from(digest(headerValue));
  return a.length === b.length && timingSafeEqual(a, b);
}