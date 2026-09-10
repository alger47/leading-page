import { jsonError, jsonOk } from '@/lib/api';
import { requireAuth } from '@/lib/auth/context';
import type { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    return jsonOk({ user: { id: user.id, email: user.email, name: user.name } });
  } catch (error) {
    return jsonError(error);
  }
}