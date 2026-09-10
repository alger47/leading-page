/**
 * Server-component auth gate (App Router). Reads the session cookie via
 * next/headers on the server; unauthenticated views redirect to /login.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { AuthContext } from './context';
import { config } from '../env';
import { resolveUserFromToken } from './session';

export async function requireServerUser(): Promise<AuthContext> {
  const token = cookies().get(config.sessionCookieName)?.value;
  const sessionUser = await resolveUserFromToken(token);
  if (!sessionUser) redirect('/login');
  return { owner: { userId: sessionUser.user.id }, user: sessionUser.user };
}