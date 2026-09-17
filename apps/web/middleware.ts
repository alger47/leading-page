import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createRateLimiter } from '@/lib/rate-limit';

/**
 * API hardening gateway (GAP-6): per-IP token-bucket rate limiting for
 * /api/v1/*. Security headers are already emitted by next.config.mjs for every
 * response (CSP, frame/X-Content-Type-Options, Referrer-Policy, etc.), so this
 * middleware only throttles. Fail-open on misconfiguration so the API is never
 * locked out by a bug here.
 */

export const config = {
  matcher: ['/api/v1/:path*'],
};

const limiter = createRateLimiter();

export function middleware(request: NextRequest) {
  if (limiter.config.disabled) return NextResponse.next();

  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
  const verdict = limiter.check(ip);

  if (!verdict.allowed) {
    return NextResponse.json(
      {
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please slow down and retry shortly.',
        },
      },
      {
        status: 429,
        headers: { 'Retry-After': String(verdict.retryAfterSeconds) },
      },
    );
  }

  const response = NextResponse.next();
  response.headers.set('X-RateLimit-Limit', String(limiter.config.capacity));
  response.headers.set('X-RateLimit-Remaining', String(verdict.remaining));
  return response;
}