/**
 * Idempotent job enqueue (§11.1 Idempotency-Key on POST /generate; §11.3
 * returns 202 { jobId }). Cross-restart retention belongs to the persistence
 * phase; within one worker process the guarantee is exact.
 */

import { createHash } from 'node:crypto';

import type { GenerationRequest, JobPayload, JobRecord } from './types.js';
import { labelFor } from './types.js';
import type { EnqueueDriver } from '../queue/ports.js';
import type { JobRecordStore } from '../store.js';
import { createTraceId } from '../telemetry.js';

export function fingerprintOf(request: GenerationRequest): string {
  const canonical = [
    request.brief,
    request.locale ?? '',
    request.tone ?? '',
    request.budgetUsd ?? '',
  ].join('\n');
  return createHash('sha256').update(canonical).digest('hex');
}

export function enqueueJobId(idempotencyKey: string): string {
  return `gen_${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 24)}`;
}

export class IdempotencyConflictError extends Error {
  readonly code = 'E-JOB-002';
}

export interface EnqueueDeps {
  store: JobRecordStore;
  queue: EnqueueDriver<JobPayload>;
}

export interface EnqueueResult {
  record: JobRecord;
  created: boolean;
}

export async function enqueue(deps: EnqueueDeps, request: GenerationRequest, idempotencyKey: string): Promise<EnqueueResult> {
  const fingerprint = fingerprintOf(request);
  const existing = deps.store.getByKey(idempotencyKey);

  if (existing !== undefined) {
    if (existing.fingerprint !== fingerprint) {
      throw new IdempotencyConflictError(
        `idempotency key ${idempotencyKey} was already used for a different request`,
      );
    }
    return { record: existing, created: false };
  }

  const id = enqueueJobId(idempotencyKey);
  const now = new Date().toISOString();
  const record: JobRecord = {
    id,
    idempotencyKey,
    fingerprint,
    label: labelFor(request),
    request,
    traceId: createTraceId(),
    status: 'QUEUED',
    createdAt: now,
    updatedAt: now,
    attemptsMade: 0,
    events: [{ type: 'job.queued', at: now }],
  };

  const payload: JobPayload = {
    brief: request.brief,
    locale: request.locale,
    tone: request.tone,
    budgetUsd: request.budgetUsd,
    idempotencyKey,
    fingerprint,
  };

  await deps.queue.add(payload, { jobId: id });
  deps.store.put(record);
  return { record, created: true };
}