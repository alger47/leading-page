/**
 * API integration (real Postgres via global-setup, FakeWorkerClient):
 * register/login/logout/me, projects, pages, and the generation lifecycle —
 * enqueue (202) → worker live-sync → persisted version (COMPLETED) → preview
 * data. Authorization matrix, idempotency, retry-after-failure nonce, CSRF,
 * and honest validation errors. No fake worker states reach the DB: the fake
 * worker is the executor, the DB mirrors it.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { GenerationService, setGenerationServiceFactory } from '../lib/generation-service';
import { FakeWorkerClient, makeApiClient, samplePageSchema, waitFor, type ApiClient } from './harness.js';

const BRIEF = 'Une agence digitale qui bâtit des sites vitrine élégants : page de garde, services, témoignages, contact.';
const LOCALE = 'fr' as const;
const TONE = 'warm-professional';

const worker = new FakeWorkerClient();
const emptyWorker = new FakeWorkerClient();
const realFactory = () => new GenerationService({ worker });
const emptyFactory = () => new GenerationService({ worker: emptyWorker });
setGenerationServiceFactory(realFactory);

afterAll(() => {
  setGenerationServiceFactory(null);
});

async function register(api: ApiClient, email: string) {
  return api.call('POST', '/api/v1/auth/register', { email, name: 'Test User', password: 'Str0ngP@ssw0rd!' });
}

async function makeUser(email: string): Promise<ApiClient> {
  const api = makeApiClient();
  await register(api, email);
  return api;
}

async function makeProjectAndPage(api: ApiClient): Promise<{ projectId: string; pageId: string }> {
  const project = await api.call('POST', '/api/v1/projects', { name: 'Studio One' });
  expect(project.status).toBe(201);
  const projectId = (await jsonOf<{ project: { id: string } }>(project)).project.id;
  const page = await api.call('POST', `/api/v1/projects/${projectId}/pages`, { title: 'Landing' });
  expect(page.status).toBe(201);
  const pageId = (await jsonOf<{ page: { id: string } }>(page)).page.id;
  return { projectId, pageId };
}

async function generate(api: ApiClient, projectId: string, pageId: string, body: Record<string, unknown> = {}) {
  return api.call('POST', '/api/v1/generate', { projectId, pageId, brief: BRIEF, locale: LOCALE, tone: TONE, ...body });
}

interface JobState {
  jobId: string;
  status: string;
  errorCode: string | null;
  result: { pageId?: string; versionNumber?: number } | null;
}

async function jsonOf<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function fetchJob(api: ApiClient, jobId: string): Promise<{ status: number; job?: JobState }> {
  const res = await api.call('GET', `/api/v1/generation-jobs/${jobId}`);
  return { status: res.status, job: (await jsonOf<{ job?: JobState }>(res)).job };
}

describe('auth flows', () => {
  it('registers, logs out, logs in, fetches /me', async () => {
    const api = await makeUser('auth-flow@example.com');
    expect(api.cookies.session.length).toBeGreaterThan(0);
    expect(api.cookies.csrf.length).toBeGreaterThan(0);

    const me = await api.call('GET', '/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect((await jsonOf<{ user: { email: string } }>(me)).user.email).toBe('auth-flow@example.com');

    await api.call('POST', '/api/v1/auth/logout');
    expect(api.cookies.session).toBe('');
    expect((await api.call('GET', '/api/v1/auth/me')).status).toBe(401);

    const login = await api.call('POST', '/api/v1/auth/login', { email: 'auth-flow@example.com', password: 'Str0ngP@ssw0rd!' });
    expect(login.status).toBe(200);
    expect((await api.call('GET', '/api/v1/auth/me')).status).toBe(200);
  });

  it('rejects a wrong password', async () => {
    const api = await makeUser('wrong-pass@example.com');
    const res = await api.call('POST', '/api/v1/auth/login', { email: 'wrong-pass@example.com', password: 'nope-nope-nope' });
    expect(res.status).toBe(401);
  });

  it('rejects duplicate email registration', async () => {
    await register(makeApiClient(), 'dup@example.com');
    const dup = await register(makeApiClient(), 'dup@example.com');
    expect(dup.status).toBe(409);
  });
});

describe('projects + pages', () => {
  it('creates and lists projects and pages under the owner', async () => {
    const api = await makeUser('projects@example.com');
    const { projectId } = await makeProjectAndPage(api);

    const list = await api.call('GET', '/api/v1/projects');
    expect(list.status).toBe(200);
    const projects = (await jsonOf<{ projects: Array<{ id: string }> }>(list)).projects;
    expect(projects.map((p) => p.id)).toContain(projectId);

    const pages = await api.call('GET', `/api/v1/projects/${projectId}/pages`);
    expect(pages.status).toBe(200);
    expect((await jsonOf<{ pages: unknown[] }>(pages)).pages.length).toBe(1);
  });

  it('scopes project/page access to the owner (404 for foreign resources)', async () => {
    const alice = await makeUser('alice-owner@example.com');
    const { pageId } = await makeProjectAndPage(alice);
    const bob = await makeUser('bob-other@example.com');

    expect((await jsonOf<{ projects: unknown[] }>(await bob.call('GET', '/api/v1/projects'))).projects).toEqual([]);
    expect((await bob.call('GET', `/api/v1/pages/${pageId}`)).status).toBe(404);
  });
});

describe('generation lifecycle (fake worker)', () => {
  it('enqueues (202), syncs RUNNING, completes with a persisted version', async () => {
    const api = await makeUser('gen-ok@example.com');
    const { projectId, pageId } = await makeProjectAndPage(api);

    const created = await generate(api, projectId, pageId);
    expect(created.status).toBe(202);
    const jobId = (await jsonOf<{ jobId: string }>(created)).jobId;

    worker.setStatus(jobId, 'RUNNING', { engineStatus: 'queued', attemptsMade: 1 });
    await fetchJob(api, jobId);

    worker.setStatus(jobId, 'COMPLETED', { result: { page: samplePageSchema() }, engineStatus: 'succeeded', attemptsMade: 1 });

    await waitFor(async () => (await fetchJob(api, jobId)).job?.status === 'COMPLETED');
    const { job } = await fetchJob(api, jobId);
    expect(job!.status).toBe('COMPLETED');
    expect(job!.result!.pageId).toBe(pageId);
    expect(job!.result!.versionNumber).toBe(1);

    const detail = await api.call('GET', `/api/v1/pages/${pageId}`);
    expect(detail.status).toBe(200);
    const latest = (await jsonOf<{ page: { latestVersion: { content: Record<string, unknown>; versionNumber: number } | null } }>(detail)).page.latestVersion;
    expect(latest).not.toBeNull();
    expect(latest!.versionNumber).toBe(1);
    expect((latest!.content as { page: { title: string } }).page.title).toBe('Agence Bakhti');
  });

  it('replays an existing job (200) when the same body is posted again', async () => {
    const api = await makeUser('gen-idem@example.com');
    const { projectId, pageId } = await makeProjectAndPage(api);

    const first = await generate(api, projectId, pageId);
    const second = await generate(api, projectId, pageId);
    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect((await jsonOf<{ jobId: string }>(second)).jobId).toBe((await jsonOf<{ jobId: string }>(first)).jobId);
  });

  it('nonces a fresh job id after a terminal FAILED attempt (same body)', async () => {
    const api = await makeUser('gen-retry@example.com');
    const { projectId, pageId } = await makeProjectAndPage(api);

    const firstRes = await generate(api, projectId, pageId);
    const firstJob = (await jsonOf<{ jobId: string }>(firstRes)).jobId;

    worker.setStatus(firstJob, 'FAILED', { error: { code: 'E-ENGINE-005', message: 'provider timed out' } });
    await waitFor(async () => (await fetchJob(api, firstJob)).job?.status === 'FAILED');
    expect((await fetchJob(api, firstJob)).job!.errorCode).toBe('E-ENGINE-005');

    const secondRes = await generate(api, projectId, pageId);
    expect(secondRes.status).toBe(202);
    expect((await jsonOf<{ jobId: string }>(secondRes)).jobId).not.toBe(firstJob);
  });

  it('marks a worked-on job failed when the worker loses it', async () => {
    const api = await makeUser('gen-lost@example.com');
    const { projectId, pageId } = await makeProjectAndPage(api);
    const res = await generate(api, projectId, pageId);
    const jobId = (await jsonOf<{ jobId: string }>(res)).jobId;

    // An empty worker (never saw the job): liveSync must fail it honestly.
    setGenerationServiceFactory(emptyFactory);
    try {
      const { job } = await fetchJob(api, jobId);
      expect(job!.status).toBe('FAILED');
      expect(job!.errorCode).toBe('E-JOB-004');
    } finally {
      setGenerationServiceFactory(realFactory);
    }
  });
});

describe('guards', () => {
  it('rejects generation with a mismatched CSRF token', async () => {
    const api = await makeUser('csrf@example.com');
    const { projectId, pageId } = await makeProjectAndPage(api);
    const res = await api.call('POST', '/api/v1/generate', { projectId, pageId, brief: BRIEF, locale: LOCALE, tone: TONE }, { 'x-csrf-token': 'bogus-token' });
    expect(res.status).toBe(403);
  });

  it('returns honest validation errors (422 E-VAL-BRIEF)', async () => {
    const api = await makeUser('val@example.com');
    const { projectId, pageId } = await makeProjectAndPage(api);
    const bad = await api.call('POST', '/api/v1/generate', { projectId, pageId, brief: '   ', locale: 'xx', tone: TONE });
    expect(bad.status).toBe(422);
    expect((await jsonOf<{ error: { code: string } }>(bad)).error.code).toBe('E-VAL-BRIEF');
  });

  it('rejects unauthenticated access to protected routes', async () => {
    const anon = makeApiClient();
    expect((await anon.call('GET', '/api/v1/projects')).status).toBe(401);
    expect((await anon.call('POST', '/api/v1/projects', { name: 'x' })).status).toBe(401);
    expect((await anon.call('POST', '/api/v1/generate', { projectId: 'p', pageId: 'x', brief: BRIEF, locale: LOCALE, tone: TONE })).status).toBe(401);
  });

  it('exposes /healthz without auth', async () => {
    const { GET } = await import('../app/api/v1/healthz/route');
    const res = await GET();
    expect(res.status).toBe(200);
  });
});