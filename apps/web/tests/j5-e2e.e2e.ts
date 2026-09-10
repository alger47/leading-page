/**
 * Acceptance J5 — publish e2e against the REAL engine + REAL worker
 * (Phase 10):
 *   auth → project → page → GENERATE (full pipeline, version 1) →
 *   publish → live public host renders the snapshot (zero editor JS) →
 *   edit → version 2 → publish v2 moves the live pointer → unpublish hides
 *   the live page (idempotent) → republish v1 restores it.
 *
 * Same seams as J1/J2/J4: local test Postgres, in-memory queue driver, stub
 * provider. Skipped automatically when apps/ai-engine/.venv is absent.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenerationService, setGenerationServiceFactory } from '../lib/generation-service';
import { HttpWorkerClient } from '../lib/worker-client';
import { getPublishedViewByHost } from '../lib/public';
import { renderPublishedHtml } from './render-html.js';
import { makeApiClient, type ApiClient, waitFor } from './harness.js';
import { engineVenvAvailable, startRealWorkerBridge, WORKER_TOKEN } from './e2e/worker-bridge.js';

const BRIEF = 'Une agence digitale qui bâtit des sites vitrine élégants : page de garde, services, témoignages, contact.';
const LOCALE = 'fr' as const;
const TONE = 'warm-professional';

async function jsonOf<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe.skipIf(!engineVenvAvailable())('J5 publish e2e (real engine + real worker)', () => {
  let api: ApiClient;
  let pageId: string;
  let host: string;
  let bridge: Awaited<ReturnType<typeof startRealWorkerBridge>>;

  beforeAll(async () => {
    bridge = await startRealWorkerBridge();
    setGenerationServiceFactory(() => new GenerationService({ worker: new HttpWorkerClient(bridge.workerBaseUrl, WORKER_TOKEN) }));
    api = makeApiClient();
    const reg = await api.call('POST', '/api/v1/auth/register', { email: 'j5-e2e@example.com', name: 'J5 User', password: 'Str0ngP@ssw0rd!' });
    expect(reg.status).toBe(201);

    const project = await api.call('POST', '/api/v1/projects', { name: 'Agence Vitrine J5' });
    const projectId = (await jsonOf<{ project: { id: string } }>(project)).project.id;

    const page = await api.call('POST', `/api/v1/projects/${projectId}/pages`, { title: 'Landing' });
    pageId = (await jsonOf<{ page: { id: string } }>(page)).page.id;

    const created = await api.call('POST', '/api/v1/generate', { projectId, pageId, brief: BRIEF, locale: LOCALE, tone: TONE });
    expect(created.status).toBe(202);
    const jobId = (await jsonOf<{ jobId: string }>(created)).jobId;
    await bridge.resume();
    await waitFor(async () => {
      const res = await api.call('GET', `/api/v1/generation-jobs/${jobId}`);
      return (await jsonOf<{ job?: { status: string } }>(res)).job?.status === 'COMPLETED';
    });

    const detail = await api.call('GET', `/api/v1/pages/${pageId}`);
    expect((await jsonOf<{ page: { latestVersion: { versionNumber: number } | null } }>(detail)).page.latestVersion!.versionNumber).toBe(1);
  });

  afterAll(async () => {
    setGenerationServiceFactory(null);
    await bridge?.close();
  });

  it('publishes the generated version to a live host that renders the snapshot', async () => {
    const res = await api.call('POST', `/api/v1/pages/${pageId}/publish`);
    expect(res.status).toBe(200);
    const { published } = await jsonOf<{ published: { host: string; versionNumber: number } }>(res);
    expect(published.versionNumber).toBe(1);
    host = published.host;

    const live = await getPublishedViewByHost(host);
    expect(live).not.toBeNull();
    expect(live!.versionNumber).toBe(1);

    const hero = (live!.content.sections as Array<{ type: string; content: Record<string, unknown> }>).find((s) => s.type === 'hero');
    const heroTitle = (hero?.content.title as string) ?? '';
    expect(heroTitle.length).toBeGreaterThan(0);

    const html = renderPublishedHtml(live!.content as Record<string, unknown>);
    expect(html).toContain(heroTitle);
    expect(html).not.toMatch(/Editor|Logout|Publish|Versions|Brief/);
  });

  it('edits the page, saves version 2, and republishing moves the live pointer', async () => {
    const detail = await api.call('GET', `/api/v1/pages/${pageId}`);
    const v1 = (await jsonOf<{ page: { latestVersion: { content: Record<string, unknown> } | null } }>(detail)).page.latestVersion!.content;

    const edited = JSON.parse(JSON.stringify(v1)) as {
      page: { title: string };
      sections: Array<{ type: string; content: Record<string, unknown> }>;
    };
    edited.page.title = 'Agence Vitrine — v2';
    const hero = edited.sections.find((s) => s.type === 'hero');
    expect(hero).toBeDefined();
    if (hero) hero.content = { ...hero.content, title: 'Notre nouvelle promesse de service' };

    const save = await api.call('POST', `/api/v1/pages/${pageId}/versions`, {
      baseVersion: 1,
      schemaVersion: '1.0.0',
      content: edited,
    });
    expect(save.status).toBe(200);
    expect((await jsonOf<{ version: { versionNumber: number } }>(save)).version.versionNumber).toBe(2);

    const move = await api.call('POST', `/api/v1/pages/${pageId}/publish`);
    const { published } = await jsonOf<{ published: { versionNumber: number; host: string } }>(move);
    expect(published.versionNumber).toBe(2);
    expect(published.host).toBe(host);

    const live = await getPublishedViewByHost(host);
    expect(live!.versionNumber).toBe(2);
    expect(renderPublishedHtml(live!.content)).toContain('Notre nouvelle promesse de service');
  });

  it('unpublishes (idempotent) and republishing v1 restores the page live', async () => {
    const drop = await api.call('DELETE', `/api/v1/pages/${pageId}/publish`);
    expect(drop.status).toBe(200);
    expect(await getPublishedViewByHost(host)).toBeNull();

    const again = await api.call('DELETE', `/api/v1/pages/${pageId}/publish`);
    expect(again.status).toBe(200);

    const repub = await api.call('POST', `/api/v1/pages/${pageId}/publish`, { versionNumber: 1 });
    expect(repub.status).toBe(200);
    const { published } = await jsonOf<{ published: { versionNumber: number; host: string } }>(repub);
    expect(published.versionNumber).toBe(1);
    expect(published.host).toBe(host);

    const live = await getPublishedViewByHost(host);
    expect(live).not.toBeNull();
    expect(live!.versionNumber).toBe(1);
  });
});