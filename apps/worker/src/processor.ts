/**
 * BullMQ job processor: web -> queue -> engine wiring.
 *
 * Lifecycle (PART X §10.2 states, §11.4 stable events):
 *   job.queued -> job.started -> stage.* -> job.completed | job.failed {code}
 *
 * Failure policy:
 * - transient (network / 5xx / timeout, exhaustion -> E-JOB-001): retried by
 *   BullMQ with exponential backoff up to maxAttempts;
 * - business: engine job FAILED (E-AI-0xx) or HTTP 422 - the engine's repair
 *   ladder already bounded those attempts, so the job is failed without retry;
 * - malformed envelope (E-JOB-004): terminal - the engine contract is broken;
 * - cancellation (E-JOB-003) and crash recovery (E-JOB-005) are honored.
 */

import { EngineClient, EngineError } from './engine/client.js';
import type { EngineJobPayload } from './engine/types.js';
import { E_JOB, STAGE_EVENT_BY_ENGINE_STAGE, isTerminal, labelFor } from './jobs/types.js';
import type { JobPayload, JobRecord } from './jobs/types.js';
import type { JobLike } from './queue/ports.js';
import type { AssetStore, JobRecordStore } from './store.js';
import type { SpanStore } from './telemetry.js';
import { createTraceId, trace } from './telemetry.js';

export interface ProcessorDeps {
  engine: EngineClient;
  store: JobRecordStore;
  spans: SpanStore;
  assets: AssetStore;
}

export const JOB_STARTED = 'job.started' as const;
export const JOB_RETRIED = 'job.retried' as const;
export const JOB_COMPLETED = 'job.completed' as const;
export const JOB_FAILED = 'job.failed' as const;

const nowIso = (): string => new Date().toISOString();

function emit(record: JobRecord, type: JobRecord['events'][number]['type'], opts?: { code?: string; detail?: string }): void {
  record.events.push({ type, at: nowIso(), ...(opts?.code !== undefined ? { code: opts.code } : {}), ...(opts?.detail !== undefined ? { detail: opts.detail } : {}) });
  record.updatedAt = nowIso();
}

function ensureRecord(deps: ProcessorDeps, jobId: string, payload: JobPayload): JobRecord {
  const existing = deps.store.get(jobId);
  if (existing !== undefined) return existing;

  // Recreated after a worker restart: the previous attempt is unverifiable.
  const record: JobRecord = {
    id: jobId,
    idempotencyKey: payload.idempotencyKey,
    fingerprint: payload.fingerprint,
    label: labelFor(payload),
    request: {
      brief: payload.brief,
      locale: payload.locale,
      tone: payload.tone,
      budgetUsd: payload.budgetUsd,
      mode: payload.mode,
      targetSectionId: payload.targetSectionId,
      page: payload.page,
      generateImages: payload.generateImages,
      suppliedImages: payload.suppliedImages,
    },
    traceId: createTraceId(),
    status: 'QUEUED',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    attemptsMade: 0,
    events: [],
  };
  emit(record, 'job.queued');
  deps.store.put(record);
  return record;
}

function stageEventsFor(payload: EngineJobPayload): Array<{ type: string; detail?: string }> {
  const events: Array<{ type: string; detail?: string }> = [];
  for (const stage of payload.stages) {
    const mapped = STAGE_EVENT_BY_ENGINE_STAGE[stage.stage];
    if (mapped === undefined) continue;
    if (!stage.ok) {
      events.push({ type: mapped, detail: `stage ${stage.stage} not ok` });
      continue;
    }
    // The engine surfaces the small brief-analysis payload so the web can show
    // an honest "brief incomplete" signal alongside the job status.
    const analysis = stage.stage === 'brief-analyzer' ? stage.data : undefined;
    events.push({ type: mapped, detail: analysis ? JSON.stringify(analysis) : undefined });
  }
  return events;
}

export async function processJob(deps: ProcessorDeps, job: JobLike, token?: string): Promise<void> {
  const payload = job.data as JobPayload;
  const jobId = job.id;
  const record = ensureRecord(deps, jobId, payload);
  if (record.status === 'CANCELLED') return;

  if (record.status === 'RUNNING') {
    // Crash recovery: an earlier execution was interrupted (stalled / killed).
    emit(record, JOB_RETRIED, { code: E_JOB.crashRecovery, detail: `attempt ${record.attemptsMade + 1} resumes an interrupted execution` });
  } else if (record.attemptsMade > 0) {
    emit(record, JOB_RETRIED, { detail: `attempt ${record.attemptsMade + 1}` });
  }

  record.status = 'RUNNING';
  record.updatedAt = nowIso();
  record.attemptsMade += 1;
  if (!record.events.some((e) => e.type === JOB_STARTED)) {
    emit(record, JOB_STARTED);
  }

  await trace(
    deps.spans,
    { name: 'job.process', kind: 'job', traceId: record.traceId, attributes: { 'job.id': jobId, 'job.label': record.label, attempt: record.attemptsMade } },
    async (root) => {
      try {
        const result = await trace<EngineJobPayload>(
          deps.spans,
          {
            name: 'engine.generate',
            kind: 'client',
            traceId: record.traceId,
            parentId: root.spanId,
            attributes: {
              'job.id': jobId,
              attempt: record.attemptsMade,
              locale: record.request.locale ?? 'auto',
              mode: record.request.mode ?? 'full',
            },
          },
          async (engineSpan) => {
            try {
              if (record.request.mode === 'section') {
                return await deps.engine.regenerateSection({
                  brief: record.request.brief,
                  locale: record.request.locale,
                  tone: record.request.tone,
                  budget_usd: record.request.budgetUsd,
                  job_id: jobId,
                  target_section_id: record.request.targetSectionId ?? '',
                  page: (record.request.page as Record<string, unknown>) ?? {},
                });
              }
              return await deps.engine.generate({
                brief: record.request.brief,
                locale: record.request.locale,
                tone: record.request.tone,
                budget_usd: record.request.budgetUsd,
                job_id: jobId,
                generate_images: record.request.generateImages,
                supplied_images: record.request.suppliedImages,
              });
            } catch (cause) {
              if (cause instanceof EngineError) {
                engineSpan.fail(cause.code, cause.message);
                engineSpan.addAttributes({ retryable: cause.retryable });
              }
              throw cause;
            }
          },
        );
        await finalizeSuccess(deps, record, result, job, token);
      } catch (cause) {
        const code = cause instanceof EngineError ? cause.code : 'E-JOB-001';
        root.fail(code, cause instanceof Error ? cause.message : String(cause));
        if (cause instanceof EngineError && cause.retryable) {
          throw cause; // let BullMQ retry; the 'failed' event finalizes on exhaustion
        }
        await handleTerminalFailure(record, job, token, code, cause);
      }
    },
  );
}

async function finalizeSuccess(deps: ProcessorDeps, record: JobRecord, result: EngineJobPayload, job: JobLike, token?: string): Promise<void> {
  for (const evt of stageEventsFor(result)) {
    emit(record, evt.type as JobRecord['events'][number]['type'], evt.detail !== undefined ? { detail: evt.detail } : undefined);
  }

  record.engineJobId = result.job_id;
  record.engineStatus = result.status;

  if (result.status === 'FAILED') {
    const code = result.error_code ?? 'E-AI-000';
    await handleTerminalFailure(record, job, token, code, new Error(result.error_message ?? 'engine job failed'));
    record.result = result;
    return;
  }

  if (record.status === 'CANCELLED') return; // cancelled while running: never mark completed

  record.result = result;

  // Stage 6 asset relay: fetch the generated rasters from the engine's
  // ephemeral store once, cache them locally, and let the web pull them via
  // GET /api/jobs/:id/assets. This MUST happen BEFORE the job flips to
  // COMPLETED: the web marks a job done the moment it sees COMPLETED and pulls
  // the asset cache once — a COMPLETED poll racing an in-flight relay would
  // ship a page with placeholders even though images were generated. Best-effort
  // any ref the engine can no longer serve (restart / eviction) simply stays on
  // the deterministic placeholder.
  if (result.assets !== undefined && result.assets.length > 0) {
    try {
      await relayAssets(deps, record.id, result.assets);
    } catch {
      /* best-effort: a failed relay still completes the job */
    }
  }

  record.status = 'COMPLETED';
  record.errorCode = undefined;
  record.errorMessage = undefined;
  const mode = (result.brief_flags as Record<string, unknown> | undefined)?.generation_mode ?? 'stub';
  emit(record, JOB_COMPLETED, { detail: JSON.stringify({ mode }) });
}

async function relayAssets(
  deps: ProcessorDeps,
  jobId: string,
  manifest: NonNullable<EngineJobPayload['assets']>,
): Promise<void> {
  for (const entry of manifest) {
    const asset = await deps.engine.fetchAsset(jobId, entry.ref);
    if (asset === null) continue;
    deps.assets.put(jobId, { ref: entry.ref, mime: asset.mime, dataB64: asset.data_b64 });
  }
}

async function handleTerminalFailure(record: JobRecord, job: JobLike, token: string | undefined, code: string, cause: unknown): Promise<void> {
  record.status = 'FAILED';
  record.errorCode = code;
  record.errorMessage = cause instanceof Error ? cause.message : String(cause);
  emit(record, JOB_FAILED, { code });
  await safeFail(job, token, code);
}

async function safeFail(job: JobLike, token: string | undefined, code: string): Promise<void> {
  // Mark the queue job failed without looping through more attempts; the
  // in-memory record stays authoritative if the queue refuses the transition.
  try {
    await job.moveToFailed(new Error(code), token);
  } catch {
    /* noop */
  }
}

export async function finalizeFailure(deps: ProcessorDeps, jobId: string, error: Error): Promise<void> {
  const record = deps.store.get(jobId);
  if (record === undefined || isTerminal(record.status)) return;

  record.status = 'FAILED';
  record.errorCode = E_JOB.unreachable;
  record.errorMessage = error.message || 'engine unreachable after retries';
  emit(record, JOB_FAILED, { code: E_JOB.unreachable });
}

export interface ProcessFn {
  (job: JobLike, token?: string): Promise<void>;
}

export function makeProcessor(deps: ProcessorDeps): { run: ProcessFn; finalizeFailure: (jobId: string, error: Error) => Promise<void> } {
  return {
    run: (job, token) => processJob(deps, job, token),
    finalizeFailure: (jobId, error) => finalizeFailure(deps, jobId, error),
  };
}