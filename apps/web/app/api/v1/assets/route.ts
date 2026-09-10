import { jsonError, jsonOk } from '@/lib/api';
import { STOCK_ASSETS } from '@/lib/assets';
import { requireAuth } from '@/lib/auth/context';
import type { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    await requireAuth(request);
    return jsonOk({ assets: STOCK_ASSETS });
  } catch (error) {
    return jsonError(error);
  }
}