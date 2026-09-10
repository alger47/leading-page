/**
 * Web test harness: an in-process FakeWorkerClient mirroring the worker API
 * contract (idempotency-key dedupe -> same job id as the web derives, live
 * status/events/results, cancel), plus session/CSRF helpers for exercising
 * Next route handlers through NextRequest/NextResponse.
 */

import { createHash } from 'node:crypto';
import { NextRequest, type NextResponse } from 'next/server';
import { config } from '../lib/env';
import type { WorkerClient, WorkerJobEvent, WorkerJobView, WorkerStatus } from '../lib/worker-client';

/** Same derivation as enqueue.ts: gen_ + sha256(key).hex[0:24]. */
export const fakeJobId = (key: string): string => `gen_${createHash('sha256').update(key).digest('hex').slice(0, 24)}`;

interface FakeJob {
  id: string;
  key: string;
  label: string;
  status: WorkerStatus;
  createdAt: string;
  updatedAt: string;
  attemptsMade: number;
  engineJobId: string | null;
  engineStatus: string | null;
  error: { code: string; message: string } | null;
  result: Record<string, unknown> | null;
  events: WorkerJobEvent[];
}

export class FakeWorkerClient implements WorkerClient {
  private readonly jobs = new Map<string, FakeJob>();

  create(input: { idempotencyKey: string; brief: string; locale?: 'ar' | 'fr' | 'en'; tone?: string; budgetUsd?: number }) {
    const jobId = fakeJobId(input.idempotencyKey);
    const existing = this.jobs.get(jobId);
    if (existing) return Promise.resolve({ jobId: existing.id, created: false });
    const now = new Date().toISOString();
    this.jobs.set(jobId, {
      id: jobId,
      key: input.idempotencyKey,
      label: input.brief.slice(0, 60),
      status: 'QUEUED',
      createdAt: now,
      updatedAt: now,
      attemptsMade: 0,
      engineJobId: null,
      engineStatus: null,
      error: null,
      result: null,
      events: [{ type: 'job.created', at: now }],
    });
    return Promise.resolve({ jobId, created: true });
  }

  get(jobId: string): Promise<WorkerJobView | null> {
    const job = this.jobs.get(jobId);
    return Promise.resolve(job ? this.view(job) : null);
  }

  getEvents(jobId: string): Promise<WorkerJobEvent[] | null> {
    const job = this.jobs.get(jobId);
    return Promise.resolve(job ? [...job.events] : null);
  }

  cancel(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job) return Promise.resolve(false);
    if (job.status === 'COMPLETED' || job.status === 'FAILED' || job.status === 'CANCELLED') return Promise.resolve(false);
    job.status = 'CANCELLED';
    job.updatedAt = new Date().toISOString();
    job.events.push({ type: 'job.cancelled', at: job.updatedAt });
    return Promise.resolve(true);
  }

  /** Test hook: advance the worker state like the real pipeline would. */
  setStatus(jobId: string, status: WorkerStatus, opts: { result?: Record<string, unknown>; error?: { code: string; message: string }; engineStatus?: string; attemptsMade?: number } = {}) {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`no fake job ${jobId}`);
    job.status = status;
    job.updatedAt = new Date().toISOString();
    job.result = opts.result ?? job.result;
    job.error = opts.error ?? null;
    job.engineStatus = opts.engineStatus ?? job.engineStatus;
    job.attemptsMade = opts.attemptsMade ?? job.attemptsMade;
    job.events.push({ type: `job.${status.toLowerCase()}`, at: job.updatedAt, code: opts.error?.code, detail: opts.error?.message });
  }

  private view(job: FakeJob): WorkerJobView {
    return {
      jobId: job.id,
      idempotencyKey: job.key,
      label: job.label,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      attemptsMade: job.attemptsMade,
      engineJobId: job.engineJobId,
      engineStatus: job.engineStatus,
      error: job.error,
      result: job.result,
    };
  }
}

/** Minimal but structurally valid Page Schema envelope (L1-clean). */
export const samplePageSchema = (): Record<string, unknown> => ({
  schemaVersion: '1.0.0',
  page: { title: 'Agence Bakhti', locale: 'fr', direction: 'ltr' },
  theme: { preset: 'warm-professional', font: 'inter', primaryColor: 'role:primary', radius: 'medium', density: 'comfortable' },
  sections: [
    {
      id: 'hero-01',
      type: 'hero',
      variant: 'split',
      content: { headline: 'Bienvenue', subheadline: 'Votre partenaire de confiance.', ctaPrimary: { label: 'Commander', href: '#contact' } },
    },
  ],
});

export interface ParsedCookies {
  session: string;
  csrf: string;
}

type NextRequestInit = NonNullable<ConstructorParameters<typeof NextRequest>[1]>;

export interface ApiClient {
  cookies: ParsedCookies;
  call(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<NextResponse>;
}

export function makeApiClient(initial?: Partial<ParsedCookies>): ApiClient {
  const state: ParsedCookies = { session: initial?.session ?? '', csrf: initial?.csrf ?? '' };

  async function call(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<NextResponse> {
    const isMutation = method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH';
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...extraHeaders,
    };
    const cookie = [state.session && `${config.sessionCookieName}=${state.session}`, state.csrf && `${config.csrfCookieName}=${state.csrf}`]
      .filter(Boolean)
      .join('; ');
    if (cookie) headers.cookie = cookie;
    if (isMutation && !('x-csrf-token' in headers)) headers['x-csrf-token'] = state.csrf;

    const init: NextRequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);

    const req = new NextRequest(new URL(`http://localhost${path}`), init);

    const handler = await routeFor(method, path);
    const res = await handler(req as never, { params: await paramsFor(path) } as never);
    const resp = res as unknown as NextResponse;

    for (const key of ['session', 'csrf'] as const) {
      const cookie = resp.cookies.get(config[`${key}CookieName`]);
      if (cookie) state[key] = cookie.value;
    }
    return resp;
  }

  return { cookies: state, call };
}

async function routeFor(method: string, path: string) {
  const mods = {
    register: '../app/api/v1/auth/register/route',
    login: '../app/api/v1/auth/login/route',
    logout: '../app/api/v1/auth/logout/route',
    me: '../app/api/v1/auth/me/route',
    projects: '../app/api/v1/projects/route',
    projectId: '../app/api/v1/projects/[projectId]/route',
    pages: '../app/api/v1/projects/[projectId]/pages/route',
    pageId: '../app/api/v1/pages/[pageId]/route',
    generate: '../app/api/v1/generate/route',
    jobId: '../app/api/v1/generation-jobs/[jobId]/route',
  };
  let mod = '';
  if (path.match(/^\/api\/v1\/auth\/(register|login|logout|me)$/)) mod = mods[path.split('/').pop()! as keyof typeof mods];
  else if (path === '/api/v1/projects') mod = mods.projects;
  else if (path.match(/^\/api\/v1\/projects\/[^/]+(\/pages)?$/)) mod = path.endsWith('/pages') ? mods.pages : mods.projectId;
  else if (path.match(/^\/api\/v1\/pages\/[^/]+$/)) mod = mods.pageId;
  else if (path === '/api/v1/generate') mod = mods.generate;
  else if (path.match(/^\/api\/v1\/generation-jobs\/[^/]+$/)) mod = mods.jobId;
  if (!mod) throw new Error(`no route mapping for ${method} ${path}`);

  const m = await import(mod);
  if (method === 'GET') return m.GET;
  if (method === 'POST') return m.POST;
  if (method === 'DELETE') return m.DELETE;
  throw new Error(`no handler for ${method}`);
}

async function paramsFor(path: string): Promise<Record<string, string>> {
  const projects = path.match(/^\/api\/v1\/projects\/([^/]+)$/);
  if (projects) return { projectId: projects[1] };
  const pages = path.match(/^\/api\/v1\/projects\/([^/]+)\/pages$/);
  if (pages) return { projectId: pages[1] };
  const pageId = path.match(/^\/api\/v1\/pages\/([^/]+)$/);
  if (pageId) return { pageId: pageId[1] };
  const jobId = path.match(/^\/api\/v1\/generation-jobs\/([^/]+)$/);
  if (jobId) return { jobId: jobId[1] };
  return {};
}

/** Poll until predicate or timeout. */
export async function waitFor(pred: () => boolean | Promise<boolean>, timeoutMs = 10_000, intervalMs = 100): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await pred()) return;
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}