import { getPrismaClient, JobsRepository } from '@landing-ai/database';
import type { NextRequest } from 'next/server';
import { ApiError, jsonError, jsonOk, requireCsrf } from '@/lib/api';
import { buildGenerationService } from '@/lib/generation-service';
import { requireAuth } from '@/lib/auth/context';
import { config } from '@/lib/env';

function jobView(job: Awaited<ReturnType<JobsRepository['get']>>) {
  return {
    jobId: job.id,
    status: job.status,
    kind: job.kind,
    targetSectionId: job.targetSectionId,
    attemptsMade: job.attemptsMade,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    result: job.resultJson,
    events: Array.isArray(job.eventsJson) ? (job.eventsJson as unknown) : [],
  };
}

export async function GET(request: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    const { owner } = await requireAuth(request);
    const owned = await new JobsRepository(getPrismaClient()).findOwnedJob(owner, params.jobId);
    if (!owned) throw new ApiError('generation job not found', 404, 'NOT_FOUND');

    const service = buildGenerationService();
    const job = await service.liveSync(owner, owned.projectId, owned.jobId);
    return jsonOk({ job: jobView(job) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    const { owner } = await requireAuth(request);
    const cookieCsrf = request.cookies.get(config.csrfCookieName)?.value;
    requireCsrf(cookieCsrf, request.headers.get('x-csrf-token') ?? undefined);

    const owned = await new JobsRepository(getPrismaClient()).findOwnedJob(owner, params.jobId);
    if (!owned) throw new ApiError('generation job not found', 404, 'NOT_FOUND');

    const service = buildGenerationService();
    const repo = new JobsRepository(getPrismaClient());
    const job = await repo.get(owner, owned.projectId, owned.jobId);

    let cancelled = false;
    if (job.status === 'QUEUED') {
      await repo.transition(owner, owned.projectId, job.id, {
        from: 'QUEUED',
        to: 'CANCELLED',
        fields: { completedAt: new Date() },
        event: { type: 'job.cancelled', at: new Date().toISOString() },
      });
      cancelled = true;
    } else if (job.status !== 'FAILED' && job.status !== 'COMPLETED') {
      cancelled = await service.cancel(job.id);
      if (cancelled) await service.liveSync(owner, owned.projectId, job.id);
    }

    const final = await repo.get(owner, owned.projectId, owned.jobId);
    return jsonOk({ job: jobView(final), cancelled });
  } catch (error) {
    return jsonError(error);
  }
}