/**
 * Acceptance J1 — happy-path e2e against the REAL engine + REAL worker:
 *   auth → project → page → GENERATE → worker processors call the real
 *   ai-engine (stub provider) → L1-validated page schema → web persists a
 *   PageVersion → the page preview serves that version over the API.
 *
 * The only substitutions vs production: Postgres is the local dev/test DB;
 * Redis is the worker's in-memory driver (same no-Docker seam the worker's
 * own e2e uses); the ai-engine runs its stub provider. Every job state the
 * user could see comes from the real pipeline — nothing is fabricated here.
 *
 * Skipped automatically when apps/ai-engine/.venv is absent (dev-only).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenerationService, setGenerationServiceFactory } from '../lib/generation-service';
import { HttpWorkerClient } from '../lib/worker-client';
import { makeApiClient, type ApiClient } from './harness.js';
import { engineVenvAvailable, startRealWorkerBridge, WORKER_TOKEN, waitFor } from './e2e/worker-bridge.js';

const BRIEF = 'Une agence digitale qui bâtit des sites vitrine élégants : page de garde, services, témoignages, contact.';
const LOCALE = 'fr' as const;
const TONE = 'warm-professional';

async function jsonOf<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

interface JobState {
  jobId: string;
  status: string;
  errorCode: string | null;
  result: { pageId?: string; versionNumber?: number } | null;
}

describe.skipIf(!engineVenvAvailable())('J1 happy path e2e (real engine + real worker)', () => {
  let api: ApiClient;
  let projectId: string;
  let pageId: string;
  let jobId: string;
  let bridge: Awaited<ReturnType<typeof startRealWorkerBridge>>;

  beforeAll(async () => {
    bridge = await startRealWorkerBridge();
    setGenerationServiceFactory(() => new GenerationService({ worker: new HttpWorkerClient(bridge.workerBaseUrl, WORKER_TOKEN) }));
    api = makeApiClient();
    const reg = await api.call('POST', '/api/v1/auth/register', { email: 'j1-e2e@example.com', name: 'J1 User', password: 'Str0ngP@ssw0rd!' });
    expect(reg.status).toBe(201);

    const project = await api.call('POST', '/api/v1/projects', { name: 'Agence Vitrine' });
    expect(project.status).toBe(201);
    projectId = (await jsonOf<{ project: { id: string } }>(project)).project.id;

    const page = await api.call('POST', `/api/v1/projects/${projectId}/pages`, { title: 'Landing' });
    expect(page.status).toBe(201);
    pageId = (await jsonOf<{ page: { id: string } }>(page)).page.id;

    const created = await api.call('POST', '/api/v1/generate', { projectId, pageId, brief: BRIEF, locale: LOCALE, tone: TONE });
    expect(created.status).toBe(202);
    jobId = (await jsonOf<{ jobId: string }>(created)).jobId;

    // Enqueue is committed in the web DB; now let the real worker process it.
    await bridge.resume();

    async function job(): Promise<{ status: number; job?: JobState }> {
      const res = await api.call('GET', `/api/v1/generation-jobs/${jobId}`);
      return { status: res.status, job: (await jsonOf<{ job?: JobState }>(res)).job };
    }

    await waitFor(async () => (await job()).job?.status === 'COMPLETED');

    await bridge.close();
    setGenerationServiceFactory(null);
  });

  afterAll(() => {
    setGenerationServiceFactory(null);
  });

  it('mirrors the real pipeline: COMPLETED job with a persisted PageVersion', async () => {
    const res = await api.call('GET', `/api/v1/generation-jobs/${jobId}`);
    expect(res.status).toBe(200);
    const state = (await jsonOf<{ job: JobState }>(res)).job;
    expect(state.status).toBe('COMPLETED');
    expect(state.errorCode).toBeNull();
    expect(state.result!.pageId).toBe(pageId);
    expect(state.result!.versionNumber).toBe(1);
  });

  it('serves the generated page for preview with an L1-valid schema', async () => {
    const detail = await api.call('GET', `/api/v1/pages/${pageId}`);
    expect(detail.status).toBe(200);
    const latest = (
      await jsonOf<{ page: { latestVersion: { content: { schemaVersion: string; page: { title: string } } } | null } }>(detail)
    ).page.latestVersion;
    expect(latest).not.toBeNull();
    expect(latest!.content.schemaVersion).toBe('1.0.0');
    expect(latest!.content.page.title.length).toBeGreaterThan(0);
  });

  it('replays the same generation (200, same jobId) thanks to worker idempotency', async () => {
    const replay = await api.call('POST', '/api/v1/generate', { projectId, pageId, brief: BRIEF, locale: LOCALE, tone: TONE });
    expect(replay.status).toBe(200);
    expect((await jsonOf<{ jobId: string }>(replay)).jobId).toBe(jobId);
  });
});