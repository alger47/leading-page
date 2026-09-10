/**
 * Session service. The browser holds an opaque random token in an
 * httpOnly/sameSite cookie; the server persists only its SHA-256 hash
 * (AuthSessionRepository). Resolution is: parse cookie → hash → verify →
 * return owning User. All of this happens server-side on every route.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { User } from '@landing-ai/database';
import { AuthSessionRepository, getPrismaClient } from '@landing-ai/database';
import { config } from '../env';

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}

export interface SessionUser {
  user: User;
  sessionId: string;
}

const sessionsRepo = () => new AuthSessionRepository(getPrismaClient());

/** Create a session for a user and return the opaque token to store in a cookie. */
export async function createSession(userId: string, ttlMs: number = config.sessionTtlMs): Promise<string> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + ttlMs);
  await sessionsRepo().create({ tokenHash: hashToken(token), userId, expiresAt });
  return token;
}

/**
 * Resolve the user behind a raw cookie value, or null.
 * Expired/revoked/forged tokens resolve to null — never an error.
 */
export async function resolveUserFromToken(rawToken: string | undefined): Promise<SessionUser | null> {
  if (!rawToken || rawToken.length < 32 || rawToken.length > 128) return null;
  const session = await sessionsRepo().verify(hashToken(rawToken));
  if (!session || session.user.deactivatedAt !== null) return null;
  await sessionsRepo().touch(session.tokenHash).catch(() => undefined);
  return { user: session.user, sessionId: session.id };
}

/** Soft-revoke the session behind a raw cookie value. */
export async function revokeSession(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  await sessionsRepo().revoke(hashToken(rawToken)).catch(() => undefined);
}

export { hashToken as hashTokenForTest };

export function tokensEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}