import type { PrismaClient, GenerationJob, GenerationAttempt, GenerationStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { Owner } from '../owner.js';
import { requireOwnedProject } from './projects.js';
import { ConflictError, NotFoundError, StateTransitionError, fromPrisma } from '../errors.js';

export type JobStatus = GenerationStatus;

export interface JobEvent {
  type: string;
  at: string;
  code?: string;
  detail?: string;
}

export interface CreateJobInput {
  id: string;
  label: string;
  brief: string;
  locale?: string | null;
  tone?: string | null;
  budgetUsd?: number | string | null;
  requestJson: Prisma.InputJsonValue;
  status?: JobStatus;
  idempotencyKey: string;
  fingerprint: string;
  traceId: string;
  pageId?: string | null;
}

export interface TransitionOptions {
  from?: JobStatus | JobStatus[];
  to: JobStatus;
  fields?: {
    errorCode?: string | null;
    errorMessage?: string | null;
    resultJson?: Prisma.InputJsonValue;
    engineJobId?: string | null;
    engineStatus?: string | null;
    attemptsMade?: number;
    traceId?: string;
    startedAt?: Date | null;
    completedAt?: Date | null;
  };
  /** Stable job event appended to eventsJson (§11.4). */
  event?: JobEvent;
}

/** §10.2 job state machine. Terminal statuses are final. */
const ALLOWED_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  QUEUED: ['RUNNING', 'FAILED', 'CANCELLED'],
  RUNNING: ['VALIDATING', 'RENDERING', 'COMPLETED', 'FAILED', 'CANCELLED'],
  VALIDATING: ['RENDERING', 'COMPLETED', 'FAILED', 'CANCELLED'],
  RENDERING: ['COMPLETED', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] as readonly string[]).includes(to);
}

export interface RecordAttemptInput {
  stage: string;
  attempt: number;
  provider?: string | null;
  model?: string | null;
  promptVersion?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  costUsd?: number | string | null;
  latencyMs?: number | null;
  outcome: 'SUCCESS' | 'FAILED' | 'RETRIED' | 'TIMED_OUT' | 'SKIPPED';
  validationJson?: Prisma.InputJsonValue | null;
}

const OWNERSHIP = (owner: Owner, projectId: string, jobId: string) => ({
  id: jobId,
  project: { id: projectId, userId: owner.userId, archivedAt: null },
});

export class JobsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(owner: Owner, projectId: string, input: CreateJobInput): Promise<GenerationJob> {
    await requireOwnedProject(this.prisma, owner, projectId);
    try {
      return await this.prisma.generationJob.create({
        data: {
          id: input.id,
          label: input.label,
          brief: input.brief,
          locale: input.locale ?? null,
          tone: input.tone ?? null,
          budgetUsd: input.budgetUsd ?? null,
          requestJson: input.requestJson,
          status: input.status ?? 'QUEUED',
          idempotencyKey: input.idempotencyKey,
          fingerprint: input.fingerprint,
          traceId: input.traceId,
          pageId: input.pageId ?? null,
          projectId,
          eventsJson: [],
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('generation_job', 'idempotencyKey', input.idempotencyKey);
      }
      throw fromPrisma(error, { entity: 'generation_job', field: 'id', value: input.id });
    }
  }

  async get(owner: Owner, projectId: string, jobId: string): Promise<GenerationJob> {
    const job = await this.prisma.generationJob.findFirst({ where: OWNERSHIP(owner, projectId, jobId) });
    if (!job) throw new NotFoundError('generation_job', jobId, owner.userId);
    return job;
  }

  async getByKey(owner: Owner, projectId: string, idempotencyKey: string): Promise<GenerationJob | null> {
    return this.prisma.generationJob.findFirst({
      where: { idempotencyKey, project: { id: projectId, userId: owner.userId, archivedAt: null } },
    });
  }

  async list(
    owner: Owner,
    projectId: string,
    { status, limit = 50, before }: { status?: JobStatus; limit?: number; before?: string } = {},
  ): Promise<GenerationJob[]> {
    await requireOwnedProject(this.prisma, owner, projectId);
    return this.prisma.generationJob.findMany({
      where: {
        projectId,
        status,
        ...(before ? { createdAt: { lt: before } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
  }

  /**
   * Apply a state-machine transition; appends the optional event to the
   * immutable eventsJson trail (§11.4). Terminal statuses are final.
   */
  async transition(owner: Owner, projectId: string, jobId: string, opts: TransitionOptions): Promise<GenerationJob> {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.generationJob.findFirst({
        where: { ...OWNERSHIP(owner, projectId, jobId) },
      });
      if (!job) throw new NotFoundError('generation_job', jobId, owner.userId);

      if (opts.from !== undefined) {
        const fromList = Array.isArray(opts.from) ? opts.from : [opts.from];
        if (!fromList.includes(job.status)) {
          throw new StateTransitionError(jobId, job.status, opts.to);
        }
      }
      if (job.status !== opts.to && !canTransition(job.status, opts.to)) {
        throw new StateTransitionError(jobId, job.status, opts.to);
      }

      const events = Array.isArray(job.eventsJson) ? (job.eventsJson as unknown as JobEvent[]) : [];
      const nextEvents = opts.event ? ([...events, opts.event] as unknown as Prisma.InputJsonValue) : undefined;

      return tx.generationJob.update({
        where: { id: job.id },
        data: {
          status: opts.to,
          ...opts.fields,
          ...(opts.event ? { eventsJson: nextEvents as Prisma.InputJsonValue } : {}),
          updatedAt: new Date(),
        },
      });
    });
  }

  async appendEvent(owner: Owner, projectId: string, jobId: string, event: JobEvent): Promise<GenerationJob> {
    return this.transition(owner, projectId, jobId, { to: (await this.get(owner, projectId, jobId)).status, event });
  }

  async recordAttempt(owner: Owner, projectId: string, jobId: string, input: RecordAttemptInput): Promise<GenerationAttempt> {
    await this.get(owner, projectId, jobId);
    const data = {
      jobId,
      stage: input.stage,
      attempt: input.attempt,
      provider: input.provider ?? null,
      model: input.model ?? null,
      promptVersion: input.promptVersion ?? null,
      tokensIn: input.tokensIn ?? null,
      tokensOut: input.tokensOut ?? null,
      costUsd: input.costUsd ?? null,
      latencyMs: input.latencyMs ?? null,
      outcome: input.outcome,
      validationJson: input.validationJson ?? Prisma.JsonNull,
    };
    const where = { jobId_stage_attempt: { jobId, stage: input.stage, attempt: input.attempt } };
    return this.prisma.generationAttempt.upsert({ where, update: data, create: data });
  }

  async attempts(owner: Owner, projectId: string, jobId: string): Promise<GenerationAttempt[]> {
    await this.get(owner, projectId, jobId);
    return this.prisma.generationAttempt.findMany({ where: { jobId }, orderBy: [{ attempt: 'asc' }, { stage: 'asc' }] });
  }
}