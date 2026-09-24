/**
 * RT ج — background finalize via the worker→web webhook.
 *
 * The DB job must reach COMPLETED (PageVersion persisted, generated rasters
 * durable) even when NO browser ever polls the job. The worker calls
 * POST /api/internal/jobs/:jobId/notify the moment the job is terminal; the
 * web reconciles through the SAME idempotent finalize path as the poll.
 *
 * Auth: service-to-service — the shared internal token is required; nothing
 * else (no session, no CSRF).
 */

import { afterAll, describe, expect, it } from 'vitest';
import { GenerationService, setGenerationServiceFactory } from '../lib/generation-service';
import { getRasterStore } from '../lib/assets';
import { getPrismaClient } from '@landing-ai/database';
import { config } from '../lib/env';
import { FakeWorkerClient, makeApiClient, publishableEnvelope, waitFor, type ApiClient } from './harness.js';

const BRIEF = 'Une école de musique à Blida: cours de piano, guitare, chant, auditions.';
const LOCALE = 'fr' as const;
const TONE = 'warm-professional';

const worker = new FakeWorkerClient();
const realFactory = () => new GenerationService({ worker });
setGenerationServiceFactory(realFactory);

afterAll(() => {
  setGenerationServiceFactory(null);
});

function tokenHeaders(): Record<string, string> {
  return { 'x-internal-token': config.workerToken };
}

async function register(api: ApiClient, email: string) {
  await api.call('POST', '/api/v1/auth/register', { email, name: 'Test User', password: 'Str0ngP@ssw0rd!' });
}

async function makeUser(email: string): Promise<ApiClient> {
  const api = makeApiClient();
  await register(api, email);
  return api;
}

async function makeProjectAndPage(api: ApiClient): Promise<{ projectId: string; pageId: string }> {
  const project = await api.call('POST', '/api/v1/projects', { name: 'Studio One' });
  const projectId = (await (await project.json() as { project: { id: string } }).project).id;
  const page = await api.call('POST', `/api/v1/projects/${projectId}/pages`, { title: 'Landing' });
  const pageId = (await (await page.json() as { page: { id: string } }).page).id;
  return { projectId, pageId };
}

async function enqueueJob(api: ApiClient, projectId: string, pageId: string) {
  const res = await api.call('POST', '/api/v1/generate', { projectId, pageId, brief: BRIEF, locale: LOCALE, tone: TONE });
  expect(res.status).toBe(202);
  return ((await res.json()) as { jobId: string }).jobId;
}

describe('background finalize — worker → web webhook', () => {
  it('finalizes a COMPLETED job to the DB WITHOUT any browser poll', async () => {
    const api = await makeUser('bg-finalize-completed@example.com');
    const { projectId, pageId } = await makeProjectAndPage(api);
    const jobId = await enqueueJob(api, projectId, pageId);

    // The browser never polls: it is closed the instant the job is submitted.
    // The worker finishes and fires its webhook; the DB must reconcile.
    worker.setStatus(jobId, 'COMPLETED', { result: { page: publishableEnvelope() }, engineStatus: 'succeeded', attemptsMade: 1 });

    const notify = await api.call('POST', `/api/internal/jobs/${jobId}/notify`, {}, tokenHeaders());
    expect(notify.status).toBe(200);

    // DB job is now terminal without ever polling.
    const db = getPrismaClient();
    const job = await db.generationJob.findUnique({ where: { id: jobId } });
    expect(job?.status).toBe('COMPLETED');

    // The PageVersion was persisted by the background finalize.
    const { pages } = await (await api.call('GET', `/api/v1/projects/${projectId}/pages`)).json() as { pages: Array<{ id: string }> };
    expect(pages.some((p) => p.id === pageId)).toBe(true);
    const versions = await db.pageVersion.count({ where: { pageId, generationJobId: jobId } });
    expect(versions).toBe(1);
  });

  it('persists the generated rasters with the version (durability, Phase 16)', async () => {
    const api = await makeUser('bg-finalize-assets@example.com');
    const { projectId, pageId } = await makeProjectAndPage(api);
    const jobId = await enqueueJob(api, projectId, pageId);

    const ref = 'asset:hero-bg';
    worker.setAssets(jobId, [{ ref, mime: 'image/png', source: 'generated', data_b64: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64') }]);
    worker.setStatus(jobId, 'COMPLETED', {
      result: {
        page: publishableEnvelope(),
        assets: [{ ref, mime: 'image/png', source: 'generated', size_bytes: 4, requirement_id: 'hero-bg' }],
      },
      engineStatus: 'succeeded',
      attemptsMade: 1,
    });

    const notify = await api.call('POST', `/api/internal/jobs/${jobId}/notify`, {}, tokenHeaders());
    expect(notify.status).toBe(200);

    // Raster bytes are in the DB (durable across restarts) via the fast-path
    // in-memory store too (served by /assets/asset/[ref] without a DB read).
    const db = getPrismaClient();
    await waitFor(async () => {
      const row = await db.generatedAsset.findFirst({ where: { jobId } });
      return row !== null && row.ref === ref;
    });
    const store = getRasterStore();
    const cached = store.get(ref);
    expect(cached?.bytes?.length ?? 0).toBe(4);
  });

  it('mirrors an honest FAILED job into the DB when no browser polls', async () => {
    const api = await makeUser('bg-finalize-failed@example.com');
    const { projectId, pageId } = await makeProjectAndPage(api);
    const jobId = await enqueueJob(api, projectId, pageId);

    worker.setStatus(jobId, 'FAILED', { error: { code: 'E-AI-021', message: 'brief.reason → none' }, attemptsMade: 2 });

    const notify = await api.call('POST', `/api/internal/jobs/${jobId}/notify`, {}, tokenHeaders());
    expect(notify.status).toBe(200);

    const db = getPrismaClient();
    await waitFor(async () => (await db.generationJob.findUnique({ where: { id: jobId } }))?.status === 'FAILED');
    const job = await db.generationJob.findUnique({ where: { id: jobId } });
    expect(job?.errorCode).toBe('E-AI-021');
  });

  it('rejects a missing / wrong internal token (401)', async () => {
    const api = await makeUser('bg-finalize-auth@example.com');
    const { projectId, pageId } = await makeProjectAndPage(api);
    const jobId = await enqueueJob(api, projectId, pageId);
    worker.setStatus(jobId, 'COMPLETED', { result: { page: publishableEnvelope() } });

    const missing = await api.call('POST', `/api/internal/jobs/${jobId}/notify`, {});
    expect(missing.status).toBe(401);

    const wrong = await api.call('POST', `/api/internal/jobs/${jobId}/notify`, {}, { 'x-internal-token': 'not-the-secret' });
    expect(wrong.status).toBe(401);

    // The job was NOT reconciled by the rejected calls.
    const db = getPrismaClient();
    const job = await db.generationJob.findUnique({ where: { id: jobId } });
    expect(job?.status).not.toBe('COMPLETED');
  });

  it('404s for an unknown jobId', async () => {
    const api = await makeUser('bg-finalize-missing@example.com');
    const res = await api.call('POST', '/api/internal/jobs/gen_nonexistent/notify', {}, tokenHeaders());
    expect(res.status).toBe(404);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });
});