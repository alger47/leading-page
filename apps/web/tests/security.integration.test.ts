/**
 * Phase 14 security audit suite (PART XII §12.1 matrix):
 *  1. IDOR — ownership enforced on every page/project/job route (cross-tenant
 *     404, not 403, so resource existence stays hidden).
 *  2. CSRF — every mutating endpoint refuses requests without a valid token.
 *  3. Healthz — unauthenticated OK endpoint, no env-probe / secret presence
 *     leaks in the body.
 * Runs against real Postgres (integration config), FakeWorkerClient.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { GenerationService, setGenerationServiceFactory } from '../lib/generation-service';
import { FakeWorkerClient, makeApiClient, publishableEnvelope, type ApiClient } from './harness.js';

const worker = new FakeWorkerClient();
setGenerationServiceFactory(() => new GenerationService({ worker }));
afterAll(() => setGenerationServiceFactory(null));

async function jsonOf<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
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
  const project = await api.call('POST', '/api/v1/projects', { name: 'Studio Sec' });
  const projectId = (await jsonOf<{ project: { id: string } }>(project)).project.id;
  const page = await api.call('POST', `/api/v1/projects/${projectId}/pages`, { title: 'Landing' });
  const pageId = (await jsonOf<{ page: { id: string } }>(page)).page.id;
  return { projectId, pageId };
}

describe('IDOR: ownership on every cross-tenant route (PART XII §12.1)', () => {
  it('returns 404 (not 403) for every foreign mutation on a page', async () => {
    const owner = await makeUser('idor-owner@example.com');
    const { projectId, pageId } = await makeProjectAndPage(owner);
    // Owner creates a publishable draft so publish/restore/regenerate targets exist.
    await owner.call('POST', `/api/v1/pages/${pageId}/versions`, { baseVersion: 0, schemaVersion: '1.0.0', content: publishableEnvelope() });

    const attacker = await makeUser('idor-attacker@example.com');

    const attempts: Array<[string, string]> = [
      ['GET', `/api/v1/pages/${pageId}`],
      ['GET', `/api/v1/pages/${pageId}/versions`],
      ['POST', `/api/v1/pages/${pageId}/versions`],
      ['POST', `/api/v1/pages/${pageId}/publish`],
      ['DELETE', `/api/v1/pages/${pageId}/publish`],
      ['POST', `/api/v1/pages/${pageId}/sections/hero-1/regenerate`],
      ['POST', `/api/v1/projects/${projectId}/pages`],
    ];
    for (const [method, path] of attempts) {
      const body =
        method === 'POST' && path.endsWith('/versions')
          ? { baseVersion: 0, schemaVersion: '1.0.0', content: publishableEnvelope() }
          : method === 'POST' && path.endsWith('/pages')
            ? { title: 'Intrusion' }
            : undefined;
      const res = await attacker.call(method, path, body);
      expect(res.status, `${method} ${path} leaked existence`).toBe(404);
    }
  });

  it('scopes generation jobs: foreign job id is 404 for both read and cancel', async () => {
    const owner = await makeUser('idor-jobs-owner@example.com');
    const { projectId, pageId } = await makeProjectAndPage(owner);
    const created = await owner.call('POST', '/api/v1/generate', { projectId, pageId, brief: 'An elegant pet-clinic landing page: hero, services, testimonials, contact section.', locale: 'fr', tone: 'warm-professional' });
    const jobId = (await jsonOf<{ jobId: string }>(created)).jobId;

    const attacker = await makeUser('idor-jobs-attacker@example.com');
    expect((await attacker.call('GET', `/api/v1/generation-jobs/${jobId}`)).status).toBe(404);
    expect((await attacker.call('DELETE', `/api/v1/generation-jobs/${jobId}`)).status).toBe(404);

    // Cross-owner generate referencing the foreign project/page must also 404
    // (a rich brief reaches the ownership check — only then is the 404 issued).
    const foreign = await attacker.call('POST', '/api/v1/generate', { projectId, pageId, brief: 'An elegant pet-clinic landing page: hero, services, testimonials, contact section.', locale: 'fr', tone: 'warm-professional' });
    expect(foreign.status).toBe(404);
  });
});

describe('CSRF: every mutating endpoint refuses a missing/mismatched token (PART XII §12.2)', () => {
  it('rejects 403 across the full mutation surface when x-csrf-token is bogus', async () => {
    const api = await makeUser('csrf-surface@example.com');
    const { projectId, pageId } = await makeProjectAndPage(api);
    await api.call('POST', `/api/v1/pages/${pageId}/versions`, { content: publishableEnvelope() });

    const bogus = { 'x-csrf-token': 'attacker-controlled' };
    const mutations: Array<[string, string, unknown?]> = [
      ['POST', '/api/v1/projects', { name: 'x' }],
      ['POST', `/api/v1/projects/${projectId}/pages`, { title: 'x' }],
      ['POST', '/api/v1/generate', { projectId, pageId, brief: 'b', locale: 'fr', tone: 'calm' }],
      ['POST', `/api/v1/pages/${pageId}/versions`, { content: publishableEnvelope() }],
      ['POST', `/api/v1/pages/${pageId}/publish`, undefined],
      ['DELETE', `/api/v1/pages/${pageId}/publish`, undefined],
      ['POST', `/api/v1/pages/${pageId}/sections/hero-1/regenerate`, { brief: 'b', locale: 'fr', tone: 'calm' }],
      ['POST', `/api/v1/pages/${pageId}/versions/1/restore`, undefined],
      ['POST', '/api/v1/auth/logout', undefined],
    ];
    for (const [method, path, body] of mutations) {
      const res = await api.call(method, path, body, bogus);
      expect(res.status, `${method} ${path} bypassed CSRF`).toBe(403);
    }
  });
});

describe('healthz (PART XII §12.1: no secret-presence disclosure)', () => {
  it('is reachable anonymously with a safe body', async () => {
    const anon = makeApiClient();
    const res = await anon.call('GET', '/api/v1/healthz');
    expect(res.status).toBe(200);
    const body = (await jsonOf<Record<string, unknown>>(res)) as {
      status?: string;
      service?: string;
      db?: string;
      worker?: string;
      envProbe?: unknown;
      presentKeysInProcess?: unknown;
      nodeEnv?: unknown;
    };
    expect(body.service).toBe('web');
    expect(['ok', 'degraded']).toContain(body.status);

    // The 2026-09-17 audit found envProbe leaking NODE_ENV and presence of
    // DATABASE_URL / WORKER_INTERNAL_TOKEN (process + /proc/1/environ). The
    // endpoint must not carry any of that.
    expect('envProbe' in body).toBe(false);
    expect('presentKeysInProcess' in body).toBe(false);
    expect('nodeEnv' in body).toBe(false);
    expect(String(body.worker ?? '')).not.toContain('token');
  });
});