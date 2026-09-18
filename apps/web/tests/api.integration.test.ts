/**
 * API integration (real Postgres via global-setup, FakeWorkerClient):
 * register/login/logout/me, projects, pages, and the generation lifecycle —
 * enqueue (202) → worker live-sync → persisted version (COMPLETED) → preview
 * data. Authorization matrix, idempotency, retry-after-failure nonce, CSRF,
 * and honest validation errors. No fake worker states reach the DB: the fake
 * worker is the executor, the DB mirrors it.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { GenerationService, setGenerationServiceFactory } from '../lib/generation-service';
import { getRasterStore } from '../lib/assets';
import { getPrismaClient } from '@landing-ai/database';
import { config } from '../lib/env';
import { getPublishedViewByHost } from '../lib/public';
import { renderPublishedHtml } from './render-html.js';
import { FakeWorkerClient, makeApiClient, publishableEnvelope, samplePageSchema, waitFor, type ApiClient } from './harness.js';

// Product-link generation (Phase 16 part 2) overrides the SSRF allowlist so
// the integration fixtures on 127.0.0.1 are reachable in tests.
process.env.PRODUCT_SOURCE_ALLOWLIST = process.env.PRODUCT_SOURCE_ALLOWLIST ?? 'aliexpress.com,127.0.0.1,localhost';

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

  it('forwards generateImages and relays generated rasters on completion (Phase 16)', async () => {
    const api = await makeUser('gen-assets@example.com');
    const { projectId, pageId } = await makeProjectAndPage(api);

    const created = await generate(api, projectId, pageId, { generateImages: true });
    expect(created.status).toBe(202);
    const jobId = (await jsonOf<{ jobId: string }>(created)).jobId;

    const createCall = worker.creates.find((c) => c.jobId === jobId);
    expect(createCall?.input.generateImages).toBe(true);

    const ref = `asset:hero-${jobId}`;
    worker.setAssets(jobId, [{ ref, mime: 'image/png', source: 'generated', data_b64: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64') }]);
    worker.setStatus(jobId, 'COMPLETED', {
      result: {
        page: samplePageSchema(),
        assets: [{ ref, requirement_id: 'hero-1', mime: 'image/png', size_bytes: 4, source: 'generated' }],
      },
    });

    await waitFor(async () => (await fetchJob(api, jobId)).job?.status === 'COMPLETED');

    const hit = getRasterStore().get(ref);
    expect(hit).toBeDefined();
    expect(hit?.mime).toBe('image/png');
    expect(Array.from(hit!.bytes)).toEqual([0x89, 0x50, 0x4e, 0x47]);

    // Opt-out jobs never ask the worker for images.
    const api2 = await makeUser('gen-noassets@example.com');
    const { projectId: p2, pageId: g2 } = await makeProjectAndPage(api2);
    const second = await generate(api2, p2, g2);
    const jobId2 = (await jsonOf<{ jobId: string }>(second)).jobId;
    expect(worker.creates.find((c) => c.jobId === jobId2)?.input.generateImages).toBe(false);
  });

  it('generation ledger: persists engine attempts as GenerationAttempt rows (GAP-2)', async () => {
    const api = await makeUser('gen-ledger@example.com');
    const { projectId, pageId } = await makeProjectAndPage(api);

    const created = await generate(api, projectId, pageId);
    expect(created.status).toBe(202);
    const jobId = (await jsonOf<{ jobId: string }>(created)).jobId;

    worker.setStatus(jobId, 'COMPLETED', {
      attemptsMade: 3,
      result: {
        page: samplePageSchema(),
        ledger: {
          attempts: 3,
          cost_usd: 0.000912,
          attempts_detail: [
            {
              stage: 'content-generator',
              attempt: 1,
              prompt: 'stage4-content-generator@v6',
              model_class: 'groq-llama-3.1-8b',
              provider: 'groq',
              model: 'llama-3.1-8b-instant',
              tokens_in: 1200,
              tokens_out: 300,
              cost_usd: 0.000012,
              latency_ms: 2450.3,
              outcome: 'ok',
              issues: [],
            },
            {
              stage: 'content-generator',
              attempt: 2,
              prompt: 'stage4-content-generator@v6',
              model_class: 'groq-llama-3.1-8b',
              provider: 'groq',
              model: 'llama-3.1-8b-instant',
              tokens_in: 900,
              tokens_out: 0,
              cost_usd: 0.0009,
              latency_ms: 50000.1,
              outcome: 'timeout',
              issues: [{ layer: 'L2', ruleId: 'SEM-007', severity: 'error', path: 'sections.0' }],
            },
            {
              stage: 'content-generator',
              attempt: 3,
              prompt: 'stage4-content-generator@v6',
              model_class: 'groq-llama-3.1-8b',
              provider: 'groq',
              model: 'llama-3.1-8b-instant',
              tokens_in: 1300,
              tokens_out: 310,
              cost_usd: 0.000013,
              latency_ms: 2380.7,
              outcome: 'ok',
              issues: [],
            },
          ],
        },
      },
    });

    await waitFor(async () => (await fetchJob(api, jobId)).job?.status === 'COMPLETED');

    const attempts = await getPrismaClient().generationAttempt.findMany({ where: { jobId }, orderBy: { attempt: 'asc' } });
    expect(attempts).toHaveLength(3);

    const first = attempts[0];
    expect(first.stage).toBe('content-generator');
    expect(first.attempt).toBe(1);
    expect(first.provider).toBe('groq');
    expect(first.model).toBe('llama-3.1-8b-instant');
    expect(first.promptVersion).toBe('stage4-content-generator@v6');
    expect(first.tokensIn).toBe(1200);
    expect(first.tokensOut).toBe(300);
    expect(first.costUsd?.toString()).toBe('0.000012');
    expect(first.latencyMs).toBe(2450);
    expect(first.outcome).toBe('SUCCESS');

    const second = attempts[1];
    expect(second.outcome).toBe('TIMED_OUT');
    expect(Array.isArray(second.validationJson)).toBe(true);
    expect((second.validationJson as Array<{ ruleId: string }>)[0].ruleId).toBe('SEM-007');

    expect(attempts[2].outcome).toBe('SUCCESS');
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

describe('phase8 editor (J3)', () => {
  it('exposes the theme presets catalog', async () => {
    const api = await makeUser('j3-themes@example.com');
    const res = await api.call('GET', '/api/v1/themes');
    expect(res.status).toBe(200);
    const { themes } = await jsonOf<{ themes: Array<{ preset: string; theme: { font: string; radius: string; density: string; primaryColor: string } }> }>(res);
    expect(themes.map((t) => t.preset)).toEqual(['warm-professional', 'cool-modern', 'bold-creative', 'minimal-clean']);
    for (const theme of themes) {
      expect(theme.theme.primaryColor.startsWith('role:')).toBe(true);
      expect(['rubik', 'cairo', 'tajawal', 'inter', 'system']).toContain(theme.theme.font);
    }
  });

  it('exposes the curated stock asset catalog', async () => {
    const api = await makeUser('j3-assets@example.com');
    const res = await api.call('GET', '/api/v1/assets');
    expect(res.status).toBe(200);
    const { assets } = await jsonOf<{ assets: Array<{ id: string; kind: string; source: string; url: string; alt: string }> }>(res);
    expect(assets.length).toBeGreaterThan(0);
    for (const asset of assets) {
      expect(asset.id.startsWith('asset:')).toBe(true);
      expect(asset.source).toBe('stock');
      expect(asset.url.startsWith('/assets/stock/')).toBe(true);
      expect(asset.alt.length).toBeGreaterThan(0);
    }
  });

  it('saves an editor edit as a new draft version (L1 blocks, L2 warns)', async () => {
    const api = await makeUser('j3-save@example.com');
    const { projectId, pageId } = await makeProjectAndPage(api);

    const created = await generate(api, projectId, pageId);
    const jobId = (await jsonOf<{ jobId: string }>(created)).jobId;
    worker.setStatus(jobId, 'COMPLETED', { result: { page: samplePageSchema() } });
    await waitFor(async () => (await fetchJob(api, jobId)).job?.status === 'COMPLETED');

    const detail = await api.call('GET', `/api/v1/pages/${pageId}`);
    const latest = (await jsonOf<{ page: { latestVersion: { versionNumber: number; content: Record<string, unknown> } | null } }>(detail)).page.latestVersion!;
    expect(latest.versionNumber).toBe(1);

    const edited = JSON.parse(JSON.stringify(latest.content)) as { page: { title: string } };
    edited.page.title = 'Agence Bakhti — version éditée';

    const save = await api.call('POST', `/api/v1/pages/${pageId}/versions`, { baseVersion: latest.versionNumber, schemaVersion: '1.0.0', content: edited });
    expect(save.status).toBe(200);
    const saved = await jsonOf<{ version: { versionNumber: number }; warnings: unknown[] }>(save);
    expect(saved.version.versionNumber).toBe(2);
    expect(Array.isArray(saved.warnings)).toBe(true);

    const after = await api.call('GET', `/api/v1/pages/${pageId}`);
    const afterLatest = (await jsonOf<{ page: { page: { versionCount: number }; latestVersion: { versionNumber: number; content: { page: { title: string } } } | null } }>(after)).page;
    expect(afterLatest.page.versionCount).toBe(2);
    expect(afterLatest.latestVersion!.content.page.title).toBe('Agence Bakhti — version éditée');
  });

  it('rejects an L1-invalid document with E-VAL-L1 (422) and saves nothing', async () => {
    const api = await makeUser('j3-invalid@example.com');
    const { projectId, pageId } = await makeProjectAndPage(api);

    const created = await generate(api, projectId, pageId);
    const jobId = (await jsonOf<{ jobId: string }>(created)).jobId;
    worker.setStatus(jobId, 'COMPLETED', { result: { page: samplePageSchema() } });
    await waitFor(async () => (await fetchJob(api, jobId)).job?.status === 'COMPLETED');

    const broken = JSON.parse(JSON.stringify(samplePageSchema())) as Record<string, unknown>;
    delete (broken.page as Record<string, unknown>).direction;

    const save = await api.call('POST', `/api/v1/pages/${pageId}/versions`, { baseVersion: 1, schemaVersion: '1.0.0', content: broken });
    expect(save.status).toBe(422);
    expect((await jsonOf<{ error: { code: string } }>(save)).error.code).toBe('E-VAL-L1');

    const after = await api.call('GET', `/api/v1/pages/${pageId}`);
    expect((await jsonOf<{ page: { page: { versionCount: number } } }>(after)).page.page.versionCount).toBe(1);
  });

  it('rejects a stale base version with 409 OPTIMISTIC_CONCURRENCY', async () => {
    const api = await makeUser('j3-concurrency@example.com');
    const { projectId, pageId } = await makeProjectAndPage(api);

    const created = await generate(api, projectId, pageId);
    const jobId = (await jsonOf<{ jobId: string }>(created)).jobId;
    worker.setStatus(jobId, 'COMPLETED', { result: { page: samplePageSchema() } });
    await waitFor(async () => (await fetchJob(api, jobId)).job?.status === 'COMPLETED');

    const stale = await api.call('POST', `/api/v1/pages/${pageId}/versions`, { baseVersion: 0, schemaVersion: '1.0.0', content: samplePageSchema() });
    expect(stale.status).toBe(409);
    expect((await jsonOf<{ error: { code: string } }>(stale)).error.code).toBe('OPTIMISTIC_CONCURRENCY');
  });

  it('regenerates one section: SECTION job queued, spliced result saved as a new version', async () => {
    const api = await makeUser('j3-regen@example.com');
    const { projectId, pageId } = await makeProjectAndPage(api);

    const created = await generate(api, projectId, pageId);
    const jobId = (await jsonOf<{ jobId: string }>(created)).jobId;
    worker.setStatus(jobId, 'COMPLETED', { result: { page: samplePageSchema() } });
    await waitFor(async () => (await fetchJob(api, jobId)).job?.status === 'COMPLETED');

    const regen = await api.call('POST', `/api/v1/pages/${pageId}/sections/hero-01/regenerate`);
    expect(regen.status).toBe(202);
    const body = await jsonOf<{ job: { jobId: string; status: string; created: boolean } }>(regen);
    expect(body.job.created).toBe(true);
    expect(body.job.status).toBe('QUEUED');

    // The DB job was created as a SECTION regeneration for the target section.
    const dbView = await api.call('GET', `/api/v1/generation-jobs/${body.job.jobId}`);
    expect(dbView.status).toBe(200);
    const dbJob = await jsonOf<{ job: { kind: string; targetSectionId: string | null; status: string } }>(dbView);
    expect(dbJob.job.kind).toBe('SECTION');
    expect(dbJob.job.targetSectionId).toBe('hero-01');

    // The worker completes with the fully spliced page; web persists version 2.
    const spliced = JSON.parse(JSON.stringify(samplePageSchema())) as { sections: Array<{ id: string; content: Record<string, string> }> };
    spliced.sections[0].content.headline = 'Bienvenue — régénéré';
    worker.setStatus(body.job.jobId, 'COMPLETED', { result: { page: spliced } });
    await waitFor(async () => (await fetchJob(api, body.job.jobId)).job?.status === 'COMPLETED');

    const after = await api.call('GET', `/api/v1/pages/${pageId}`);
    const latest = (await jsonOf<{ page: { page: { versionCount: number }; latestVersion: { versionNumber: number; content: { sections: Array<{ id: string; content: Record<string, string> }> } } | null } }>(after)).page;
    expect(latest.page.versionCount).toBe(2);
    expect(latest.latestVersion!.versionNumber).toBe(2);
    expect(latest.latestVersion!.content.sections[0].content.headline).toBe('Bienvenue — régénéré');
  });

  it('rejects regeneration of a section that no longer exists (404 SECTION_NOT_FOUND)', async () => {
    const api = await makeUser('j3-regen-missing-section@example.com');
    const { projectId, pageId } = await makeProjectAndPage(api);

    const created = await generate(api, projectId, pageId);
    const jobId = (await jsonOf<{ jobId: string }>(created)).jobId;
    worker.setStatus(jobId, 'COMPLETED', { result: { page: samplePageSchema() } });
    await waitFor(async () => (await fetchJob(api, jobId)).job?.status === 'COMPLETED');

    const res = await api.call('POST', `/api/v1/pages/${pageId}/sections/ghost-01/regenerate`);
    expect(res.status).toBe(404);
    expect((await jsonOf<{ error: { code: string } }>(res)).error.code).toBe('SECTION_NOT_FOUND');
  });
});

describe('phase9 versioning (J4)', () => {
  /** Generate version 1, then save an edited copy as version 2. */
  async function makeTwoVersions(api: ApiClient): Promise<{ projectId: string; pageId: string; editedContent: Record<string, unknown> }> {
    const { projectId, pageId } = await makeProjectAndPage(api);

    const created = await generate(api, projectId, pageId);
    const jobId = (await jsonOf<{ jobId: string }>(created)).jobId;
    worker.setStatus(jobId, 'COMPLETED', { result: { page: samplePageSchema() } });
    await waitFor(async () => (await fetchJob(api, jobId)).job?.status === 'COMPLETED');

    const edited = JSON.parse(JSON.stringify(samplePageSchema())) as { page: { title: string; locale: string; direction: string }; sections: Array<{ id: string; content: Record<string, string> }> };
    edited.page.title = 'Agence Bakhti — version éditée';
    edited.sections[0].content.headline = 'Bienvenue — nouvelle une';

    const save = await api.call('POST', `/api/v1/pages/${pageId}/versions`, { baseVersion: 1, schemaVersion: '1.0.0', content: edited });
    expect(save.status).toBe(200);
    expect((await jsonOf<{ version: { versionNumber: number } }>(save)).version.versionNumber).toBe(2);
    return { projectId, pageId, editedContent: edited as unknown as Record<string, unknown> };
  }

  it('lists the immutable version history (metadata only, ascending)', async () => {
    const api = await makeUser('j4-list@example.com');
    const { pageId } = await makeTwoVersions(api);

    const res = await api.call('GET', `/api/v1/pages/${pageId}/versions`);
    expect(res.status).toBe(200);
    const { versions } = await jsonOf<{ versions: Array<{ versionNumber: number; schemaVersion: string; createdAt: string; createdBy: string | null; content?: unknown }> }>(res);
    expect(versions.map((v) => v.versionNumber)).toEqual([1, 2]);
    for (const version of versions) {
      expect(version.schemaVersion).toBe('1.0.0');
      expect(typeof version.createdAt).toBe('string');
      expect('content' in version).toBe(false);
    }
  });

  it('serves a single immutable version snapshot including content; 404 on unknown', async () => {
    const api = await makeUser('j4-detail@example.com');
    const { pageId } = await makeTwoVersions(api);

    const one = await api.call('GET', `/api/v1/pages/${pageId}/versions/1`);
    expect(one.status).toBe(200);
    const { version } = await jsonOf<{ version: { versionNumber: number; content: { page: { title: string }; sections: Array<{ id: string }> } } }>(one);
    expect(version.versionNumber).toBe(1);
    expect(version.content.page.title).toBe('Agence Bakhti');
    expect(version.content.sections[0].id).toBe('hero-01');

    const missing = await api.call('GET', `/api/v1/pages/${pageId}/versions/99`);
    expect(missing.status).toBe(404);
  });

  it('compares two versions: metadata + section diff summary with changed slots', async () => {
    const api = await makeUser('j4-compare@example.com');
    const { pageId, editedContent } = await makeTwoVersions(api);

    const res = await api.call('GET', `/api/v1/pages/${pageId}/versions/compare?from=1&to=2`);
    expect(res.status).toBe(200);
    const { from, to, diff } = await jsonOf<{
      from: number;
      to: number;
      diff: { metadata: { title: { changed: boolean; previous: string | null; current: string | null }; locale: { changed: boolean }; direction: { changed: boolean }; theme: { changed: boolean } }; counts: { added: number; removed: number; changed: number; unchanged: number }; sections: Array<{ id: string; action: string; changedSlots?: string[] }> };
    }>(res);
    expect({ from, to }).toEqual({ from: 1, to: 2 });
    expect(diff.metadata.title.changed).toBe(true);
    expect(diff.metadata.locale.changed).toBe(false);
    expect(diff.metadata.direction.changed).toBe(false);
    expect(diff.metadata.theme.changed).toBe(false);
    expect(diff.counts).toEqual({ added: 0, removed: 0, changed: 1, unchanged: 0 });
    expect(diff.sections).toEqual([expect.objectContaining({ id: 'hero-01', action: 'changed', changedSlots: ['content.headline'] })]);
    expect(editedContent).toBeTruthy();

    // Reversed comparison reports the same slots.
    const reversed = await api.call('GET', `/api/v1/pages/${pageId}/versions/compare?from=2&to=1`);
    const rev = await jsonOf<{ diff: { sections: Array<{ id: string; action: string; changedSlots?: string[] }> } }>(reversed);
    expect(rev.diff.sections[0]).toEqual(expect.objectContaining({ id: 'hero-01', action: 'changed', changedSlots: ['content.headline'] }));

    const invalid = await api.call('GET', `/api/v1/pages/${pageId}/versions/compare?from=0&to=2`);
    expect(invalid.status).toBe(400);
  });

  it('restores a previous version into a NEW version; history stays immutable', async () => {
    const api = await makeUser('j4-restore@example.com');
    const { pageId } = await makeTwoVersions(api);

    const restored = await api.call('POST', `/api/v1/pages/${pageId}/versions/1/restore`);
    expect(restored.status).toBe(200);
    const body = await jsonOf<{ version: { versionNumber: number; restoredFrom: number } }>(restored);
    expect(body.version.restoredFrom).toBe(1);
    expect(body.version.versionNumber).toBe(3);

    const after = await api.call('GET', `/api/v1/pages/${pageId}`);
    const latest = (await jsonOf<{ page: { page: { versionCount: number }; latestVersion: { versionNumber: number; content: { page: { title: string }; sections: Array<{ id: string; content: Record<string, string> }> } } | null } }>(after)).page;
    expect(latest.page.versionCount).toBe(3);
    expect(latest.latestVersion!.versionNumber).toBe(3);
    expect(latest.latestVersion!.content.page.title).toBe('Agence Bakhti');
    expect(latest.latestVersion!.content.sections[0].content.headline).toBe('Bienvenue');

    // The edited v2 is untouched: restore COPIES, it never rewrites history.
    const two = await api.call('GET', `/api/v1/pages/${pageId}/versions/2`);
    const v2 = await jsonOf<{ version: { content: { page: { title: string }; sections: Array<{ id: string; content: Record<string, string> }> } } }>(two);
    expect(v2.version.content.page.title).toBe('Agence Bakhti — version éditée');
    expect(v2.version.content.sections[0].content.headline).toBe('Bienvenue — nouvelle une');
  });

  it('restoring an unknown version 404s; foreign pages are 404 everywhere', async () => {
    const api = await makeUser('j4-authz@example.com');
    const { pageId } = await makeTwoVersions(api);

    const missing = await api.call('POST', `/api/v1/pages/${pageId}/versions/99/restore`);
    expect(missing.status).toBe(404);

    const outsider = await makeUser('j4-outsider@example.com');
    const list = await outsider.call('GET', `/api/v1/pages/${pageId}/versions`);
    expect(list.status).toBe(404);
    const detail = await outsider.call('GET', `/api/v1/pages/${pageId}/versions/1`);
    expect(detail.status).toBe(404);
    const compare = await outsider.call('GET', `/api/v1/pages/${pageId}/versions/compare?from=1&to=2`);
    expect(compare.status).toBe(404);
    const restore = await outsider.call('POST', `/api/v1/pages/${pageId}/versions/1/restore`);
    expect(restore.status).toBe(404);
  });
});

describe('phase10 publishing (J5)', () => {
  /** Create a page whose v1 is L1+L2-clean (publishable) without an engine. */
  async function makePublishablePage(api: ApiClient): Promise<{ projectId: string; pageId: string }> {
    const { projectId, pageId } = await makeProjectAndPage(api);
    const save = await api.call('POST', `/api/v1/pages/${pageId}/versions`, {
      baseVersion: 0,
      schemaVersion: '1.0.0',
      content: publishableEnvelope(),
    });
    expect(save.status).toBe(200);
    return { projectId, pageId };
  }

  it('publishes the latest validated version to a stable subdomain host', async () => {
    const api = await makeUser('j5-publish@example.com');
    const { pageId } = await makePublishablePage(api);

    const res = await api.call('POST', `/api/v1/pages/${pageId}/publish`);
    expect(res.status).toBe(200);
    const { published } = await jsonOf<{ published: { host: string; url: string; versionNumber: number; publishedAt: string } }>(res);
    expect(published.versionNumber).toBe(1);
    expect(published.host.endsWith(`.${config.publicHostSuffix}`)).toBe(true);
    expect(published.url).toBe(`${config.publicBaseUrl}/${published.host}`);

    const live = await getPublishedViewByHost(published.host);
    expect(live).not.toBeNull();
    expect(live!.versionNumber).toBe(1);

    // Deterministic HTML from the SAME renderer, with zero editor/dashboard markers.
    const html = renderPublishedHtml(live!.content);
    expect(html).toContain('Soins vétérinaires de confiance');
    expect(html).not.toMatch(/Editor|Logout|Brief|Publish|Versions/);
  });

  it('republishing is idempotent and keeps the same host', async () => {
    const api = await makeUser('j5-idem@example.com');
    const { pageId } = await makePublishablePage(api);

    const first = await api.call('POST', `/api/v1/pages/${pageId}/publish`);
    const second = await api.call('POST', `/api/v1/pages/${pageId}/publish`);
    expect(second.status).toBe(200);
    const a = (await jsonOf<{ published: { host: string; versionNumber: number } }>(first)).published;
    const b = (await jsonOf<{ published: { host: string; versionNumber: number } }>(second)).published;
    expect(b.host).toBe(a.host);
    expect(b.versionNumber).toBe(a.versionNumber);
  });

  it('republishing an older version moves the live pointer (history intact)', async () => {
    const api = await makeUser('j5-pointer@example.com');
    const { pageId } = await makePublishablePage(api);

    const edited = publishableEnvelope({ title: 'Cabinet Vetrilleux — v2' }) as { page: { title: string }; sections: unknown[] };
    const save = await api.call('POST', `/api/v1/pages/${pageId}/versions`, { baseVersion: 1, schemaVersion: '1.0.0', content: edited });
    expect(save.status).toBe(200);
    expect((await jsonOf<{ version: { versionNumber: number } }>(save)).version.versionNumber).toBe(2);

    await api.call('POST', `/api/v1/pages/${pageId}/publish`);
    const move = await api.call('POST', `/api/v1/pages/${pageId}/publish`, { versionNumber: 1 });
    const { published } = await jsonOf<{ published: { versionNumber: number } }>(move);
    expect(published.versionNumber).toBe(1);

    const detail = await api.call('GET', `/api/v1/pages/${pageId}`);
    expect((await jsonOf<{ page: { page: { versionCount: number } } }>(detail)).page.page.versionCount).toBe(2);
  });

  it('the publish gate rejects an L2-invalid version (422 E-PUBLISH-001)', async () => {
    const api = await makeUser('j5-gate@example.com');
    const { pageId } = await makePublishablePage(api);

    // L1-valid but L2-invalid: page without a footer (SEM-004). Draft saves fine.
    const broken = publishableEnvelope({ footer: false });
    const save = await api.call('POST', `/api/v1/pages/${pageId}/versions`, { baseVersion: 1, schemaVersion: '1.0.0', content: broken });
    expect(save.status).toBe(200);
    expect((await jsonOf<{ version: { versionNumber: number } }>(save)).version.versionNumber).toBe(2);

    const res = await api.call('POST', `/api/v1/pages/${pageId}/publish`);
    expect(res.status).toBe(422);
    const { error } = await jsonOf<{ error: { code: string; details: { issues: Array<{ layer: string; ruleId: string }> } } }>(res);
    expect(error.code).toBe('E-PUBLISH-001');
    expect(error.details.issues).toEqual(expect.arrayContaining([expect.objectContaining({ ruleId: 'SEM-004' })]));
  });

  it('publishing an unknown version returns 404', async () => {
    const api = await makeUser('j5-404@example.com');
    const { pageId } = await makePublishablePage(api);
    const res = await api.call('POST', `/api/v1/pages/${pageId}/publish`, { versionNumber: 99 });
    expect(res.status).toBe(404);
  });

  it('unpublish is an idempotent downgrade-to-draft that hides the live page', async () => {
    const api = await makeUser('j5-unpub@example.com');
    const { pageId } = await makePublishablePage(api);

    await api.call('POST', `/api/v1/pages/${pageId}/publish`);
    const host = (await jsonOf<{ published: { host: string } }>(await api.call('POST', `/api/v1/pages/${pageId}/publish`))).published.host;

    const drop = await api.call('DELETE', `/api/v1/pages/${pageId}/publish`);
    expect(drop.status).toBe(200);
    expect((await jsonOf<{ published: null }>(drop)).published).toBeNull();
    expect(await getPublishedViewByHost(host)).toBeNull();

    // Second unpublish is a 200 no-op (already a draft).
    const again = await api.call('DELETE', `/api/v1/pages/${pageId}/publish`);
    expect(again.status).toBe(200);

    // Republish after unpublish brings the page back on the SAME host.
    const repub = await api.call('POST', `/api/v1/pages/${pageId}/publish`);
    expect((await jsonOf<{ published: { host: string } }>(repub)).published.host).toBe(host);
    expect(await getPublishedViewByHost(host)).not.toBeNull();
  });

  it('foreign tenants and anons cannot publish or unpublish', async () => {
    const api = await makeUser('j5-owner@example.com');
    const { pageId } = await makePublishablePage(api);

    const outsider = await makeUser('j5-outsider@example.com');
    expect((await outsider.call('POST', `/api/v1/pages/${pageId}/publish`)).status).toBe(404);
    expect((await outsider.call('DELETE', `/api/v1/pages/${pageId}/publish`)).status).toBe(404);

    const anon = makeApiClient();
    expect((await anon.call('POST', `/api/v1/pages/${pageId}/publish`)).status).toBe(401);
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

describe('product-link generation (Phase 16 part 2)', () => {
  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const TINY_PNG = Buffer.from([...PNG_SIG, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x08]);
  const PAGE_HTML = `<!doctype html><html><head><script>
window.runParams = {"data":{"root":{"fields":{
  "titleModule":{"subject":"Product-Link Integration Item"},
  "priceModule":{"formatedActivityPrice":"EUR 39,00"},
  "featureList":[{"text":"Original item"},{"text":"Fast dispatch"}],
  "imagePathList":["http://127.0.0.1:PORT/1.webp","http://127.0.0.1:PORT/2.webp"]}
}}};
</script></head></html>`;

  let server: Server | null = null;
  let base = '';

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = req.url ?? '';
      const port = portOf();
      if (url === '/product') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(PAGE_HTML.replaceAll('PORT', String(port)));
        return;
      }
      if (url === '/1.webp' || url === '/2.webp') {
        res.writeHead(200, { 'content-type': 'image/webp' });
        res.end(TINY_PNG);
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${portOf()}`;
  });

  function portOf(): number {
    const address = server?.address();
    return typeof address === 'object' && address !== null ? address.port : 0;
  }

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  });

  it('extract endpoint reads a product page into a suggested brief + thumbnails', async () => {
    const api = await makeUser('prod-extract@example.com');
    expect(api.cookies.session.length).toBeGreaterThan(0);

    const res = await api.call('POST', '/api/v1/product/extract', { url: `${base}/product` });
    expect(res.status).toBe(200);
    const product = (await jsonOf<{ product: { title: string; suggestions?: string; suggestedBrief: string; images: unknown[] } }>(res)).product;
    expect(product.title).toBe('Product-Link Integration Item');
    expect(product.suggestedBrief).toContain('Product-Link Integration Item');
    expect(product.images).toHaveLength(2);
  });

  it('generate with productUrl re-derives supplied rasters server-side and relays them', async () => {
    const api = await makeUser('prod-gen@example.com');
    const { projectId, pageId } = await makeProjectAndPage(api);

    const created = await generate(api, projectId, pageId, { generateImages: true, productUrl: `${base}/product` });
    expect(created.status).toBe(202);
    const jobId = (await jsonOf<{ jobId: string }>(created)).jobId;

    const createCall = worker.creates.find((c) => c.jobId === jobId);
    const supplied = createCall?.input.suppliedImages as Array<{ ref: string; mime: string; data_b64: string }> | undefined;
    expect(supplied).toHaveLength(2);
    expect(supplied![0].ref).toBe('product-1');
    expect(supplied![0].mime).toBe('image/png');
    expect(Buffer.from(supplied![0].data_b64, 'base64').subarray(0, 8).equals(PNG_SIG)).toBe(true);
    expect(supplied![1].ref).toBe('product-2');

    const ref = 'asset:hero-x';
    worker.setAssets(jobId, [{ ref, mime: 'image/png', source: 'supplied', requirement_id: 'hero-1', data_b64: TINY_PNG.toString('base64') }]);
    worker.setStatus(jobId, 'COMPLETED', {
      result: {
        page: samplePageSchema(),
        assets: [{ ref, requirement_id: 'hero-1', mime: 'image/png', size_bytes: TINY_PNG.length, source: 'supplied' }],
      },
    });

    await waitFor(async () => (await fetchJob(api, jobId)).job?.status === 'COMPLETED');

    const hit = getRasterStore().get(ref);
    expect(hit).toBeDefined();
    expect(hit?.mime).toBe('image/png');
    expect(Array.from(hit!.bytes)).toEqual(Array.from(TINY_PNG));
  });

  it('returns a red honest error for a disallowed product host', async () => {
    const api = await makeUser('prod-bad@example.com');
    const { projectId, pageId } = await makeProjectAndPage(api);
    const res = await generate(api, projectId, pageId, { generateImages: true, productUrl: 'https://example.com/item/1' });
    expect(res.status).toBe(400);
    expect((await jsonOf<{ error: { code: string } }>(res)).error.code).toBe('E-PROD-001');
  });
});