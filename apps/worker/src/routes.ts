/**
 * Worker HTTP API (fastify).
 *   POST   /api/jobs                     create / replay a generation job (Idempotency-Key)
 *   GET    /api/jobs/:id                 status + result refs
 *   GET    /api/jobs/:id/events          stable lifecycle events (§11.4)
 *   GET    /api/jobs/:id/spans           telemetry spans for the job trace
 *   DELETE /api/jobs/:id                 cancel (E-JOB-003)
 *   GET    /healthz                      liveness + engine reachability
 */

import type { FastifyError, FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';

import type { EngineClient } from './engine/client.js';
import { IdempotencyConflictError, enqueue } from './jobs/enqueue.js';
import { E_JOB, isTerminal } from './jobs/types.js';
import type { GenerationRequest } from './jobs/types.js';
import type { WorkerConfig } from './config.js';
import type { EnqueueDriver } from './queue/ports.js';
import type { JobRecordStore } from './store.js';
import type { SpanStore } from './telemetry.js';
import type { JobPayload } from './jobs/types.js';

export interface WorkerContext {
  store: JobRecordStore;
  spans: SpanStore;
  queue: EnqueueDriver<JobPayload>;
  engine: EngineClient;
  config: WorkerConfig;
}

function errorEnvelope(code: string, message: string, details?: Record<string, unknown>): Record<string, unknown> {
  return {
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
      docs: `/docs/errors/${code}`,
    },
  };
}

const POST_JOB_SCHEMA = {
  type: 'object',
  required: ['brief'],
  additionalProperties: false,
  properties: {
    brief: { type: 'string', minLength: 1, maxLength: 4_000 },
    locale: { type: 'string', enum: ['ar', 'fr', 'en'] },
    tone: { type: 'string', minLength: 1, maxLength: 64 },
    budgetUsd: { type: 'number', exclusiveMinimum: 0, maximum: 10 },
    mode: { type: 'string', enum: ['full', 'section'] },
    targetSectionId: { type: 'string', minLength: 1, maxLength: 64 },
    page: { type: 'object' },
  },
} as const;

export function registerRoutes(app: FastifyInstance, ctx: WorkerContext): void {
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const statusCode = error instanceof IdempotencyConflictError ? 422 : error.statusCode ?? 500;
    const code = error instanceof IdempotencyConflictError ? E_JOB.idempotencyConflict : statusCode >= 500 ? 'E-INTERNAL-001' : 'E-VAL-REQ-001';
    reply.status(statusCode).send(errorEnvelope(code, error.message));
  });

  app.get('/healthz', async () => {
    const engineReachable = await ctx.engine.healthz();
    return {
      status: 'ok',
      service: 'worker',
      queue: { name: ctx.queue.name, engineReachable },
      engine: { url: ctx.config.engineUrl, reachable: engineReachable },
    };
  });

  app.post<{ Body: GenerationRequest; Headers: Record<string, string | undefined> }>(
    '/api/jobs',
    { schema: { body: POST_JOB_SCHEMA } },
    async (request, reply) => {
      const idempotencyKey = (request.headers['idempotency-key'] ?? '').trim() || fingerprintFallback(request.body);
      const { record, created } = await enqueue(ctx, request.body, idempotencyKey);
      reply.header('location', `/api/jobs/${record.id}`);
      void created;
      reply.status(created ? 202 : 200);
      return { jobId: record.id, status: record.status };
    },
  );

  app.get<{ Params: { id: string } }>('/api/jobs/:id', async (request, reply) => {
    const record = ctx.store.get(request.params.id);
    if (record === undefined) {
      reply.status(404).send(errorEnvelope('E-JOB-NOT-FOUND', `job ${request.params.id} not found`));
      return reply;
    }
    return jobView(record);
  });

  app.get<{ Params: { id: string } }>('/api/jobs/:id/events', async (request, reply) => {
    const record = ctx.store.get(request.params.id);
    if (record === undefined) {
      reply.status(404).send(errorEnvelope('E-JOB-NOT-FOUND', `job ${request.params.id} not found`));
      return reply;
    }
    return { jobId: record.id, events: record.events };
  });

  app.get<{ Params: { id: string } }>('/api/jobs/:id/spans', async (request, reply) => {
    const record = ctx.store.get(request.params.id);
    if (record === undefined) {
      reply.status(404).send(errorEnvelope('E-JOB-NOT-FOUND', `job ${request.params.id} not found`));
      return reply;
    }
    return { jobId: record.id, traceId: record.traceId, spans: ctx.spans.spansForTrace(record.traceId) };
  });

  app.delete<{ Params: { id: string } }>('/api/jobs/:id', async (request, reply) => {
    const record = ctx.store.get(request.params.id);
    if (record === undefined) {
      reply.status(404).send(errorEnvelope('E-JOB-NOT-FOUND', `job ${request.params.id} not found`));
      return reply;
    }
    if (isTerminal(record.status)) {
      reply
        .status(409)
        .send(errorEnvelope(E_JOB.cancelled, `job ${record.id} already finished (${record.status})`, { jobId: record.id }));
      return reply;
    }
    record.status = 'CANCELLED';
    record.errorCode = E_JOB.cancelled;
    record.errorMessage = 'cancelled by request';
    record.events.push({ type: 'job.cancelled', at: new Date().toISOString(), code: E_JOB.cancelled });
    record.updatedAt = new Date().toISOString();
    await ctx.queue.remove(record.id).catch(() => undefined);
    return { jobId: record.id, status: record.status };
  });
}

function fingerprintFallback(request: GenerationRequest): string {
  // Deterministic derived key when the client sends no Idempotency-Key, so a
  // duplicate POST of the same payload does not spawn a second job.
  const canonical = [
    request.brief,
    request.locale ?? '',
    request.tone ?? '',
    String(request.budgetUsd ?? ''),
    request.mode ?? 'full',
    request.targetSectionId ?? '',
  ].join('\n');
  return `derived:${createHash('sha256').update(canonical).digest('hex')}`;
}

function jobView(record: import('./jobs/types.js').JobRecord): Record<string, unknown> {
  return {
    jobId: record.id,
    idempotencyKey: record.idempotencyKey,
    label: record.label,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    attemptsMade: record.attemptsMade,
    engineJobId: record.engineJobId ?? null,
    engineStatus: record.engineStatus ?? null,
    mode: (record.request as GenerationRequest).mode ?? 'full',
    targetSectionId: (record.request as GenerationRequest).targetSectionId ?? null,
    error: record.errorCode !== undefined ? { code: record.errorCode, message: record.errorMessage } : null,
    result: record.result ?? null,
  };
}