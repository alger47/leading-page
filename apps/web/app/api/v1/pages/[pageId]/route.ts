import { getPrismaClient, PagesRepository } from '@landing-ai/database';
import { ApiError, jsonError, jsonOk } from '@/lib/api';
import { getPageDetailView } from '@/lib/data';
import { requireAuth } from '@/lib/auth/context';
import type { NextRequest } from 'next/server';

export async function GET(request: NextRequest, { params }: { params: { pageId: string } }) {
  try {
    const { owner } = await requireAuth(request);
    const owned = await new PagesRepository(getPrismaClient()).findOwnedPage(owner, params.pageId);
    if (!owned) throw new ApiError('page not found', 404, 'NOT_FOUND');
    const detail = await getPageDetailView(owner, owned.projectId, owned.pageId);
    return jsonOk({ page: detail });
  } catch (error) {
    return jsonError(error);
  }
}