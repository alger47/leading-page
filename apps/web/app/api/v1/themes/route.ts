import { THEME_PRESETS } from '@landing-ai/page-schema';
import { jsonError, jsonOk } from '@/lib/api';
import { requireAuth } from '@/lib/auth/context';
import type { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    await requireAuth(request);
    return jsonOk({ themes: THEME_PRESETS });
  } catch (error) {
    return jsonError(error);
  }
}