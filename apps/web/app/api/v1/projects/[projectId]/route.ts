import { jsonError, jsonOk } from '@/lib/api';
import { getProjectView } from '@/lib/data';
import { requireAuth } from '@/lib/auth/context';
import type { NextRequest } from 'next/server';

export async function GET(request: NextRequest, { params }: { params: { projectId: string } }) {
  try {
    const { owner } = await requireAuth(request);
    const project = await getProjectView(owner, params.projectId);
    return jsonOk({ project });
  } catch (error) {
    return jsonError(error);
  }
}