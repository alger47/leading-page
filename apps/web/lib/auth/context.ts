/**
 * Authenticated request context for API routes. Server-side authorization
 * (§12.2): the session cookie resolves to an Owner; every repository call is
 * then scoped to that Owner. The frontend hiding things is never
 * authorization — the API enforces it.
 */

import type { NextRequest } from 'next/server';
import type { Owner, User } from '@landing-ai/database';
import { ApiError } from '../api';
import { config } from '../env';
import { resolveUserFromToken } from './session';

export interface AuthContext {
  owner: Owner;
  user: User;
}

export async function resolveAuth(request: Pick<NextRequest, 'cookies'>): Promise<AuthContext | null> {
  const token = request.cookies.get(config.sessionCookieName)?.value;
  const sessionUser = await resolveUserFromToken(token);
  if (!sessionUser) return null;
  return { owner: { userId: sessionUser.user.id }, user: sessionUser.user };
}

/** Resolve the session or throw a 401 ApiError (route handlers). */
export async function requireAuth(request: Pick<NextRequest, 'cookies'>): Promise<AuthContext> {
  const auth = await resolveAuth(request);
  if (!auth) throw new ApiError('authentication required', 401, 'E-AUTH-001');
  return auth;
}