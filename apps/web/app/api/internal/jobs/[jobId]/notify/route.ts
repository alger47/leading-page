import { timingSafeEqual } from 'node:crypto';
import { getPrismaClient, JobsRepository } from '@landing-ai/database';
import type { NextRequest } from 'next/server';
import { ApiError, jsonError, jsonOk } from '@/lib/api';
import { buildGenerationService } from '@/lib/generation-service';
import { config } from '@/lib/env';

/**
 * POST /api/internal/jobs/:jobId/notify — service-to-service background
 * finalize (RT ج).
 *
 * The worker calls this the instant a job reaches a terminal state
 * (COMPLETED/FAILED/CANCELLED), so the web persists the PageVersion and the
 * generated rasters WITHOUT waiting for the next browser poll. The handler
 * reuses the exact same idempotent finalize path as liveSync — guarded by DB
 * transitions and runExclusive — so replays/races from the worker are harmless.
 *
 * Auth: service-to-service only. The caller must present the shared internal
 * token (X-Internal-Token), the same secret the web uses to call the worker.
 * No session, no CSRF: this route is never reachable from a tenant browser.
 */
export async function POST(request: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    const provided = request.headers.get('x-internal-token') ?? '';
    const expected = config.workerToken;
    if (provided.length === 0 || provided.length !== expected.length || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
      throw new ApiError('missing or invalid internal token', 401, 'E-AUTH-001');
    }

    // Resolve the job without a tenant filter (authenticated service channel).
    const found = await new JobsRepository(getPrismaClient()).findAny(params.jobId);
    if (!found) throw new ApiError('generation job not found', 404, 'NOT_FOUND');

    // Reuse the browser-poll finalize path on the SERVER side: it mirrors the
    // worker's terminal view into the DB (version + assets) idempotently.
    const service = buildGenerationService();
    const job = await service.liveSync({ userId: found.userId }, found.projectId, found.jobId);
    return jsonOk({ jobId: job.id, status: job.status });
  } catch (error) {
    return jsonError(error);
  }
}