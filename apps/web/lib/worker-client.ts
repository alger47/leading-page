/**
 * Typed HTTP client for the worker API (Phase 5). The web enqueues
 * GenerationJobs here and mirrors live status/events back into the database.
 * The transport (HTTP) is the seam the real-engine e2e swaps for an
 * in-process pipeline so J1 can be verified without Redis.
 */

export type WorkerStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'VALIDATING'
  | 'RENDERING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface WorkerJobView {
  jobId: string;
  idempotencyKey: string;
  label: string;
  status: WorkerStatus;
  createdAt: string;
  updatedAt: string;
  attemptsMade: number;
  engineJobId: string | null;
  engineStatus: string | null;
  mode: 'full' | 'section';
  targetSectionId: string | null;
  error: { code: string; message: string } | null;
  /** EngineJobPayload once the pipeline produced one (result.page = the Page Schema). */
  result: Record<string, unknown> | null;
}

export interface WorkerJobEvent {
  type: string;
  at: string;
  code?: string;
  detail?: string;
}

export interface CreateJobInput {
  idempotencyKey: string;
  brief: string;
  locale?: 'ar' | 'fr' | 'en';
  tone?: string;
  budgetUsd?: number;
  /** 'section' regenerates only one section (Phase 8 J2); requires
   * `targetSectionId` and the current `page`. */
  mode?: 'full' | 'section';
  targetSectionId?: string;
  page?: unknown;
}

export interface WorkerClient {
  create(input: CreateJobInput): Promise<{ jobId: string; created: boolean }>;
  get(jobId: string): Promise<WorkerJobView | null>;
  getEvents(jobId: string): Promise<WorkerJobEvent[] | null>;
  cancel(jobId: string): Promise<boolean>;
}

export class WorkerCallError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'WorkerCallError';
    this.code = code;
    this.status = status;
  }
}

const CREATE_TIMEOUT_MS = 20_000;
const POLL_TIMEOUT_MS = 10_000;

export class HttpWorkerClient implements WorkerClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(workerUrl: string, token: string) {
    this.baseUrl = workerUrl.replace(/\/+$/, '');
    this.headers = { 'x-internal-token': token };
  }

  async create(input: CreateJobInput): Promise<{ jobId: string; created: boolean }> {
    const res = await this.request('/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': input.idempotencyKey, ...this.headers },
      body: JSON.stringify({ brief: input.brief, locale: input.locale, tone: input.tone, budgetUsd: input.budgetUsd, mode: input.mode, targetSectionId: input.targetSectionId, page: input.page }),
    }, CREATE_TIMEOUT_MS);

    const body = (await res.json()) as { jobId?: string; status?: string; error?: { code?: string; message?: string } };
    if (res.status === 202) return { jobId: body.jobId ?? '', created: true };
    if (res.status === 200) return { jobId: body.jobId ?? '', created: false };
    throw new WorkerCallError(
      body.error?.message ?? `worker rejected job creation with HTTP ${res.status}`,
      body.error?.code ?? 'E-JOB-UNKNOWN',
      res.status,
    );
  }

  async get(jobId: string): Promise<WorkerJobView | null> {
    const res = await this.request(`/api/jobs/${encodeURIComponent(jobId)}`, { method: 'GET', headers: this.headers }, POLL_TIMEOUT_MS);
    if (res.status === 404) return null;
    return (await res.json()) as WorkerJobView;
  }

  async getEvents(jobId: string): Promise<WorkerJobEvent[] | null> {
    const res = await this.request(`/api/jobs/${encodeURIComponent(jobId)}/events`, { method: 'GET', headers: this.headers }, POLL_TIMEOUT_MS);
    if (res.status === 404) return null;
    const body = (await res.json()) as { events?: WorkerJobEvent[] };
    return body.events ?? [];
  }

  async cancel(jobId: string): Promise<boolean> {
    const res = await this.request(`/api/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE', headers: this.headers }, POLL_TIMEOUT_MS);
    if (res.status === 404) return false;
    if (res.status === 409) return false; // already terminal
    return res.status === 200;
  }

  private async request(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(`${this.baseUrl}${path}`, { ...init, signal: controller.signal });
    } catch (cause) {
      const aborted = cause instanceof Error && cause.name === 'AbortError';
      throw new WorkerCallError(
        aborted ? `worker request timed out (${path})` : `worker unreachable at ${this.baseUrl}`,
        'E-JOB-001',
        503,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}