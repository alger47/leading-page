/**
 * Generation orchestration from the web side (PD-07: DB is source of truth;
 * the worker is the async executor). Flow per request:
 *   1. Create/atomically dedupe the database GenerationJob row (QUEUED) with a
 *      job id that matches the worker's (see generation-key.ts).
 *   2. Enqueue through the worker API with the SAME idempotency key.
 *   3. liveSync() mirrors worker status/events into the DB; on COMPLETED it
 *      persists the returned Page Schema as an immutable PageVersion and points
 *      the job result at (pageId, versionNumber).
 * No fake states: the DB only ever reflects the worker; failures are recorded
 * with their real error codes.
 */

import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import {
  getPrismaClient,
  JobsRepository,
  PagesRepository,
  ProjectsRepository,
  type GenerationJob,
  type Owner,
} from '@landing-ai/database';
import { labelForFeedback } from './validation';
import { deriveIdempotencyKey, jobIdForIdempotencyKey } from './generation-key';
import { mapEngineAttemptsToDb } from './generation-attempts';
import { getRasterStore } from './assets';
import { HttpWorkerClient, WorkerCallError, type WorkerClient } from './worker-client';
import { webConfig, DEV_WORKER_TOKEN, type WebConfig } from './env';
import { validateBriefInput } from './validation';

export interface StartGenerationInput {
  owner: Owner;
  projectId: string;
  pageId: string;
  brief: string;
  locale: 'ar' | 'fr' | 'en';
  tone: string;
  clientIdempotencyKey?: string;
  /** Opt into engine Stage 6 image generation (Phase 16). Best-effort: when
   * the engine feature is off, the job simply completes without an asset
   * manifest and placeholders are used. */
  generateImages?: boolean;
  /** Product-link rasters (Phase 16 part 2): real product image bytes the
   * engine uses verbatim. Derived server-side from `productUrl`, capped. */
  suppliedImages?: Array<{ ref: string; mime: string; data_b64: string }>;
}

/** Phase 8 J2: regenerate ONE section. The `page` is the current draft
 * (latest version content) and `targetSectionId` names the section whose
 * content the pipeline will rebuild; the worker streams back a full spliced
 * Page Schema that is persisted as a NEW draft version. */
export interface StartSectionGenerationInput {
  owner: Owner;
  projectId: string;
  pageId: string;
  targetSectionId: string;
  /** Current Page Schema (latestVersion.content). */
  page: unknown;
  /** Latest version number — encodes the source version into the key. */
  baseVersion: number;
  brief: string;
  locale: 'ar' | 'fr' | 'en';
  tone: string;
}

export interface StartGenerationResult {
  jobId: string;
  created: boolean;
  status: string;
}

export interface GenerationServiceDeps {
  worker?: WorkerClient;
  now?: () => Date;
}

function repos() {
  const prisma = getPrismaClient();
  return {
    projects: new ProjectsRepository(prisma),
    pages: new PagesRepository(prisma),
    jobs: new JobsRepository(prisma),
  };
}

/**
 * Per-job serialization for the finalize path: liveSync may be called
 * concurrently (polling + immediate reads). Without it two overlapping
 * finalize passes would persist duplicate versions and fight over the final
 * result. The DB transition guards stay as the backstop.
 */
const finalizeRunners = new Map<string, Promise<unknown>>();
function runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = finalizeRunners.get(key) ?? Promise.resolve();
  const next = previous.then(task, task);
  finalizeRunners.set(key, next.catch(() => undefined));
  const cleanup = () => {
    if (finalizeRunners.get(key) === next) finalizeRunners.delete(key);
  };
  void next.then(cleanup, cleanup);
  return next;
}

let serviceFactory: ((deps?: GenerationServiceDeps) => GenerationService) | null = null;

/** Test seam: the harness injects a custom WorkerClient (in-process real-engine bridge in e2e). */
export function setGenerationServiceFactory(fn: ((deps?: GenerationServiceDeps) => GenerationService) | null): void {
  serviceFactory = fn;
}

export function buildGenerationService(): GenerationService {
  return serviceFactory ? serviceFactory() : new GenerationService();
}

export class GenerationService {
  private readonly worker: WorkerClient;

  constructor(deps: GenerationServiceDeps = {}, _cfg: WebConfig = webConfig()) {
    // Fail-closed (§12.4): a production build must never reach the worker using
    // the well-known local-development token (would let any caller impersonate
    // the platform). This guard sits at the request boundary (constructor is
    // called per-request), NOT in webConfig(), because webConfig() also runs
    // during `next build` where NODE_ENV=production and secrets are absent.
    if (_cfg.isProd && _cfg.workerToken === DEV_WORKER_TOKEN) {
      throw new Error('refusing to call the worker: WORKER_INTERNAL_TOKEN is unset (dev default)');
    }
    this.worker = deps.worker ?? new HttpWorkerClient(_cfg.workerUrl, _cfg.workerToken);
  }

  async start(input: StartGenerationInput): Promise<StartGenerationResult> {
    const briefError = validateBriefInput(input.brief);
    if (briefError) throw new GenerationInputError(briefError);

    const { projects, pages, jobs } = repos();
    await projects.get(input.owner, input.projectId);
    await pages.get(input.owner, input.projectId, input.pageId);

    // Retry nonce: how many terminal failed/cancelled attempts exist for this page.
    const priorJobs = await jobs.listByPage(input.owner, input.projectId, input.pageId);
    const terminalCount = priorJobs.filter((j) => j.status === 'FAILED' || j.status === 'CANCELLED').length;
    const key = deriveIdempotencyKey(input.owner.userId, input.pageId, terminalCount, input.clientIdempotencyKey);
    const jobId = jobIdForIdempotencyKey(key);

    // Already have a job for this exact key? Return it (idempotent re-submit, §11.1).
    const existing = await jobs.getByKey(input.owner, input.projectId, key);
    if (existing) {
      return { jobId: existing.id, created: false, status: existing.status };
    }

    const now = new Date();
    const request = { brief: input.brief, locale: input.locale, tone: input.tone, ...(input.generateImages === true ? { generateImages: true } : {}) };
    const created = await jobs.create(input.owner, input.projectId, {
      id: jobId,
      label: labelForFeedback(input.brief),
      brief: input.brief,
      locale: input.locale,
      tone: input.tone,
      requestJson: request,
      idempotencyKey: key,
      fingerprint: key,
      traceId: `web_${randomUUID()}`,
      pageId: input.pageId,
      status: 'QUEUED',
    });
    await jobs.appendEvent(input.owner, input.projectId, jobId, { type: 'job.queued', at: now.toISOString() });

    try {
      const res = await this.worker.create({
        idempotencyKey: key,
        brief: input.brief,
        locale: input.locale,
        tone: input.tone,
        generateImages: input.generateImages,
        suppliedImages: input.suppliedImages,
      });
      return { jobId: created.id, created: res.created, status: 'QUEUED' };
    } catch (error) {
      // Honest failure: the job could not be handed to the executor. Record it
      // in the DB and surface the real code to the caller.
      const code = error instanceof WorkerCallError ? error.code : 'E-INTERNAL-001';
      const message = error instanceof Error ? error.message : String(error);
      await jobs
        .transition(input.owner, input.projectId, jobId, {
          from: 'QUEUED',
          to: 'FAILED',
          fields: { errorCode: code, errorMessage: message, completedAt: new Date() },
          event: { type: 'job.failed', at: new Date().toISOString(), code, detail: message },
        })
        .catch(() => undefined);
      throw error;
    }
  }

  /** Ask the worker to cancel an in-flight job (best effort, mirrors after). */
  async cancel(jobId: string): Promise<boolean> {
    return this.worker.cancel(jobId);
  }

  /**
   * Enqueue a SECTION regeneration job (Phase 8 J2). Mirrors {@link start}
   * but the idempotency key is namespaced `regen:...` and encodes the source
   * version, so re-clicking the same "regenerate" produces the same job while
   * a regeneration over a NEWER draft is a brand-new job.
   */
  async startSection(input: StartSectionGenerationInput): Promise<StartGenerationResult> {
    const { projects, pages, jobs } = repos();
    await projects.get(input.owner, input.projectId);
    await pages.get(input.owner, input.projectId, input.pageId);

    const page = (input.page ?? {}) as { sections?: Array<{ id?: string }> };
    const hit = (page.sections ?? []).some((s) => s.id === input.targetSectionId);
    if (!hit) throw new SectionNotFoundError(input.targetSectionId);

    const key = `regen:${input.owner.userId}:${input.pageId}:${input.baseVersion}:${input.targetSectionId}:${createHash('sha256').update(input.brief).digest('hex').slice(0, 8)}`;
    const jobId = jobIdForIdempotencyKey(key);

    const existing = await jobs.getByKey(input.owner, input.projectId, key);
    if (existing) {
      return { jobId: existing.id, created: false, status: existing.status };
    }

    const now = new Date();
    const request = { mode: 'section', brief: input.brief, locale: input.locale, tone: input.tone, targetSectionId: input.targetSectionId };
    const created = await jobs.create(input.owner, input.projectId, {
      id: jobId,
      label: labelForFeedback(input.brief),
      brief: input.brief,
      locale: input.locale,
      tone: input.tone,
      kind: 'SECTION',
      targetSectionId: input.targetSectionId,
      requestJson: request,
      idempotencyKey: key,
      fingerprint: key,
      traceId: `web_${randomUUID()}`,
      pageId: input.pageId,
      status: 'QUEUED',
    });
    await jobs.appendEvent(input.owner, input.projectId, jobId, { type: 'job.queued', at: now.toISOString() });

    try {
      const res = await this.worker.create({
        idempotencyKey: key,
        brief: input.brief,
        locale: input.locale,
        tone: input.tone,
        mode: 'section',
        targetSectionId: input.targetSectionId,
        page: input.page,
      });
      return { jobId: created.id, created: res.created, status: 'QUEUED' };
    } catch (error) {
      const code = error instanceof WorkerCallError ? error.code : 'E-INTERNAL-001';
      const message = error instanceof Error ? error.message : String(error);
      await jobs
        .transition(input.owner, input.projectId, jobId, {
          from: 'QUEUED',
          to: 'FAILED',
          fields: { errorCode: code, errorMessage: message, completedAt: new Date() },
          event: { type: 'job.failed', at: new Date().toISOString(), code, detail: message },
        })
        .catch(() => undefined);
      throw error;
    }
  }

  /**
   * Mirror the worker's live state onto the database record. Idempotent and
   * race-safe: transitions are guarded, and once the job is terminal the DB is
   * the source of truth (further calls become no-ops unless the worker still
   * reports a conflicting terminal state, which we ignore).
   */
  async liveSync(owner: Owner, projectId: string, jobId: string): Promise<GenerationJob> {
    const { jobs } = repos();
    const job = await jobs.get(owner, projectId, jobId);
    // A FAILED record is kept as the last-known truth, but it is NOT final:
    // a transient BullMQ attempt may have failed the DB record while a later
    // retry succeeded. We still query the worker; if it now reports a valid
    // COMPLETED result, the DB record self-heals to COMPLETED (F1 fix).
    const skipping = (status: string) => status === 'COMPLETED' || status === 'CANCELLED';
    if (skipping(job.status)) return job;

    let view;
    let events: Array<{ type: string; at: string; code?: string; detail?: string }> = [];
    try {
      view = await this.worker.get(jobId);
      events = (await this.worker.getEvents(jobId).catch(() => [])) ?? [];
    } catch (error) {
      // Worker momentarily unreachable: keep the last-known state (honest).
      return job;
    }
    if (!view) {
      // Worker lost sight of this job. Only escalate a NON-terminal record to
      // FAILED; an already-FAILED record keeps its real error code.
      if (job.status !== 'FAILED') {
        await jobs
          .transition(owner, projectId, jobId, {
            from: job.status,
            to: 'FAILED',
            fields: { errorCode: 'E-JOB-004', errorMessage: 'worker lost sight of this job', completedAt: new Date() },
            event: { type: 'job.failed', at: new Date().toISOString(), code: 'E-JOB-004' },
          })
          .catch(() => undefined);
      }
      return jobs.get(owner, projectId, jobId);
    }

    // Append worker events we have not persisted yet.
    const known = Array.isArray(job.eventsJson) ? (job.eventsJson as Array<{ type: string; at: string }>) : [];
    const knownKeys = new Set(known.map((e) => `${e.type}@${e.at}`));
    const fresh = events.filter((e) => !knownKeys.has(`${e.type}@${e.at}`));
    for (const event of fresh) {
      await jobs.appendEvent(owner, projectId, jobId, event).catch(() => undefined);
    }

    if (view.status === 'COMPLETED' || view.status === 'FAILED' || view.status === 'CANCELLED') {
      return runExclusive(`finalize:${jobId}`, () => this.finalize(owner, projectId, jobId, view.status as 'COMPLETED' | 'FAILED' | 'CANCELLED', view));
    }

    // In-flight mirror.
    await jobs
      .transition(owner, projectId, jobId, {
        from: job.status,
        to: view.status || 'RUNNING',
        fields: {
          engineJobId: view.engineJobId ?? null,
          engineStatus: view.engineStatus ?? null,
          attemptsMade: view.attemptsMade ?? 0,
        },
      })
      .catch(() => undefined);
    return jobs.get(owner, projectId, jobId);
  }

  private async finalize(
    owner: Owner,
    projectId: string,
    jobId: string,
    to: 'COMPLETED' | 'FAILED' | 'CANCELLED',
    view: Awaited<ReturnType<WorkerClient['get']>>,
  ): Promise<GenerationJob> {
    const { jobs, pages } = repos();
    const job = await jobs.get(owner, projectId, jobId);
    // Active states can be finalized normally. A FAILED record may ALSO be
    // finalized to COMPLETED when the worker delivers a valid page (transient
    // attempt failed the record, a retry succeeded — self-heal, see F1).
    const active = job.status === 'QUEUED' || job.status === 'RUNNING' || job.status === 'VALIDATING' || job.status === 'RENDERING';
    if (job.status !== 'FAILED' && !active) return job;
    if (job.status === 'FAILED' && to !== 'COMPLETED') return job;

    // Persist the engine ledger into GenerationAttempt rows (GAP-2). Runs once
    // per terminal finalize; recordAttempt upserts per (jobId, stage, attempt)
    // so replays are no-ops and a self-healed FAILED→COMPLETED keeps the
    // attempts that actually produced the page.
    await this.persistAttempts(owner, projectId, jobId, view);

    let fields: Record<string, unknown> = {
      errorCode: null,
      errorMessage: null,
      engineJobId: view?.engineJobId ?? null,
      engineStatus: view?.engineStatus ?? null,
      completedAt: new Date(),
    };

    if (to === 'COMPLETED') {
      const envelope = (view?.result as { page?: unknown } | null)?.page;
      if (!envelope || typeof envelope !== 'object') {
        to = 'FAILED';
        fields = {
          ...fields,
          errorCode: 'E-JOB-004',
          errorMessage: 'job completed on the worker without a page schema',
        };
      } else {
        try {
          const pageId = job.pageId;
          if (!pageId) throw new Error('completed job has no bound page');
          const version = await pages.saveVersion(owner, projectId, pageId, {
            baseVersion: (await pages.listVersions(owner, projectId, pageId)).length,
            schemaVersion: (envelope as { schemaVersion?: string }).schemaVersion ?? '1.0.0',
            content: envelope,
          });
          fields.resultJson = { pageId, versionNumber: version.versionNumber };
          await jobs
            .transition(owner, projectId, jobId, {
              from: job.status as never,
              to: 'COMPLETED',
              fields: fields as never,
              event: { type: 'job.completed', at: new Date().toISOString() },
            })
            .catch(() => undefined);
          // Phase 16: relay the generated rasters from the worker's asset cache
          // into the server-side store so /assets/asset/[ref] can serve bytes
          // memory-first. Best-effort — a missing relay just keeps the
          // deterministic placeholder (never a broken <img>).
          await this.relayAssets(view, jobId).catch(() => undefined);
          return jobs.get(owner, projectId, jobId);
        } catch (error) {
          // Invalid schema from the engine would have been caught by L1 inside
          // saveVersion; surface honestly as a failed job, never a fake result.
          to = 'FAILED';
          fields = {
            ...fields,
            errorCode: 'E-VAL-L1',
            errorMessage: error instanceof Error ? error.message : String(error),
          };
        }
      }
    }

    if (to === 'FAILED' && (fields.errorCode as string | null) == null) {
      // Persist the REAL worker error.code (honest failure surface, never a fake).
      fields = {
        ...fields,
        errorCode: view?.error?.code ?? 'E-JOB-003',
        errorMessage: view?.error?.message ?? 'the worker reported a failed job',
      };
    }

    const finalTo = to as 'COMPLETED' | 'FAILED' | 'CANCELLED';
    const eventType = finalTo === 'COMPLETED' ? 'job.completed' : finalTo === 'FAILED' ? 'job.failed' : 'job.cancelled';
    await jobs
      .transition(owner, projectId, jobId, {
        from: job.status as never,
        to: finalTo,
        fields: fields as never,
        event: { type: eventType, at: new Date().toISOString(), code: finalTo === 'FAILED' ? ((fields.errorCode as string) ?? undefined) : undefined },
      })
      .catch(() => undefined);
    return jobs.get(owner, projectId, jobId);
  }

  /** Write the engine's per-attempt ledger rows (best-effort, idempotent). */
  private async persistAttempts(
    owner: Owner,
    projectId: string,
    jobId: string,
    view: Awaited<ReturnType<WorkerClient['get']>>,
  ): Promise<void> {
    const { jobs } = repos();
    const detail = (view?.result as { ledger?: { attempts_detail?: readonly unknown[] } } | null)?.ledger?.attempts_detail;
    if (!Array.isArray(detail) || detail.length === 0) return;
    const rows = mapEngineAttemptsToDb(detail);
    for (const input of rows) {
      await jobs.recordAttempt(owner, projectId, jobId, input).catch(() => undefined);
    }
  }

  /** Phase 16: move the worker-cached generated rasters into the server-side
   * RasterMemoryStore so the /assets/asset/[ref] route serves bytes it has. */
  private async relayAssets(
    view: Awaited<ReturnType<WorkerClient['get']>>,
    jobId: string,
  ): Promise<void> {
    const manifest = (view?.result as { assets?: readonly unknown[] } | null)?.assets;
    if (!Array.isArray(manifest) || manifest.length === 0) return;
    if (this.worker.getAssets === undefined) return;
    const assets = await this.worker.getAssets(jobId);
    if (!assets || assets.length === 0) return;
    const store = getRasterStore();
    for (const asset of assets) {
      if (typeof asset.ref !== 'string' || typeof asset.data_b64 !== 'string' || asset.data_b64 === '') continue;
      let bytes: Buffer;
      try {
        bytes = Buffer.from(asset.data_b64, 'base64');
      } catch {
        continue; // corrupt relay entry — placeholder wins, never a broken byte burst
      }
      if (bytes.length === 0) continue;
      store.put(asset.ref, { mime: asset.mime || 'image/png', bytes });
    }
  }
}

export class GenerationInputError extends Error {
  readonly code = 'E-VAL-BRIEF';
  constructor(message: string) {
    super(message);
    this.name = 'GenerationInputError';
  }
}

export class SectionNotFoundError extends Error {
  readonly code = 'SECTION_NOT_FOUND';
  constructor(sectionId: string) {
    super(`section "${sectionId}" does not exist in the current draft`);
    this.name = 'SectionNotFoundError';
  }
}