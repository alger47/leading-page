/**
 * Acceptance J4 — versioning e2e against the REAL engine + REAL worker
 * (Phase 9):
 *   auth → project → page → GENERATE (full pipeline, version 1) →
 *   save a local edit as version 2 → compare 1 vs 2 (metadata + section diff
 *   summary) → restore version 1 → a NEW version 3 whose content equals the
 *   immutable v1 snapshot (restore copies, never rewrites) and history stays
 *   intact.
 *
 * Same seams as J1/J2: local test Postgres, in-memory queue driver, stub
 * provider. Skipped automatically when apps/ai-engine/.venv is absent.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenerationService, setGenerationServiceFactory } from '../lib/generation-service';
import { HttpWorkerClient } from '../lib/worker-client';
import { makeApiClient, type ApiClient, waitFor } from './harness.js';
import { engineVenvAvailable, startRealWorkerBridge } from './e2e/worker-bridge.js';

const BRIEF = 'Une agence digitale qui bâtit des sites vitrine élégants : page de garde, services, témoignages, contact.';
const LOCALE = 'fr' as const;
const TONE = 'warm-professional';

async function jsonOf<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

interface Content {
  schemaVersion: string;
  page: { title: string; locale?: string };
  sections: Array<{ id: string; type: string; content: Record<string, unknown> }>;
}

interface PageDetail {
  page: {
    page: { versionCount: number };
    latestVersion: { versionNumber: number; schemaVersion: string; content: Content } | null;
  };
}

async function pageDetail(api: ApiClient, pageId: string): Promise<PageDetail> {
  return jsonOf(await api.call('GET', `/api/v1/pages/${pageId}`));
}

describe.skipIf(!engineVenvAvailable())('J4 versioning e2e (real engine + real worker)', () => {
  let api: ApiClient;
  let pageId: string;
  let ctx: { v1Content: Content };
  let bridge: Awaited<ReturnType<typeof startRealWorkerBridge>>;

  beforeAll(async () => {
    bridge = await startRealWorkerBridge();
    setGenerationServiceFactory(() => new GenerationService({ worker: new HttpWorkerClient(bridge.workerBaseUrl) }));
    api = makeApiClient();
    const reg = await api.call('POST', '/api/v1/auth/register', { email: 'j4-e2e@example.com', name: 'J4 User', password: 'Str0ngP@ssw0rd!' });
    expect(reg.status).toBe(201);

    const project = await api.call('POST', '/api/v1/projects', { name: 'Agence Vitrine J4' });
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

    const detail = await pageDetail(api, pageId);
    expect(detail.page.latestVersion!.versionNumber).toBe(1);
    ctx = { v1Content: detail.page.latestVersion!.content };
  });

  afterAll(async () => {
    setGenerationServiceFactory(null);
    await bridge?.close();
  });

  it('saves a local edit as version 2 (same code path as the editor)', async () => {
    const edited = JSON.parse(JSON.stringify(ctx.v1Content)) as Content;
    edited.page.title = 'Agence Vitrine — version éditée';
    const hero = edited.sections.find((s) => s.type === 'hero');
    expect(hero).toBeDefined();
    if (hero) hero.content = { ...hero.content, title: 'Notre nouvelle promesse' };

    const save = await api.call('POST', `/api/v1/pages/${pageId}/versions`, {
      baseVersion: 1,
      schemaVersion: ctx.v1Content.schemaVersion,
      content: edited,
    });
    expect(save.status).toBe(200);
    const body = await jsonOf<{ version: { versionNumber: number }; warnings: unknown[] }>(save);
    expect(body.version.versionNumber).toBe(2);
  });

  it('compares version 1 vs 2 and reports the changed title + hero copy', async () => {
    const res = await api.call('GET', `/api/v1/pages/${pageId}/versions/compare?from=1&to=2`);
    expect(res.status).toBe(200);
    const { diff } = await jsonOf<{
      diff: {
        metadata: { title: { changed: boolean; previous: string | null; current: string | null }; locale: { changed: boolean }; direction: { changed: boolean }; theme: { changed: boolean } };
        counts: { added: number; removed: number; changed: number; unchanged: number };
        sections: Array<{ id: string; action: string; changedSlots?: string[] }>;
      };
    }>(res);
    expect(diff.metadata.title).toEqual({ previous: ctx.v1Content.page.title, current: 'Agence Vitrine — version éditée', changed: true });
    const hero = diff.sections.find((s) => s.action === 'changed');
    expect(hero).toBeDefined();
    expect(hero?.changedSlots).toContain('content.title');
  });

  it('restores version 1 into a NEW version 3 with the immutable v1 snapshot', async () => {
    const restored = await api.call('POST', `/api/v1/pages/${pageId}/versions/1/restore`);
    expect(restored.status).toBe(200);
    const body = await jsonOf<{ version: { versionNumber: number; restoredFrom: number } }>(restored);
    expect(body.version.restoredFrom).toBe(1);
    expect(body.version.versionNumber).toBe(3);

    const after = await pageDetail(api, pageId);
    expect(after.page.page.versionCount).toBe(3);
    expect(after.page.latestVersion!.versionNumber).toBe(3);
    // Deep-equality: restored content must BE version 1's snapshot.
    expect(after.page.latestVersion!.content).toEqual(ctx.v1Content);

    // History is untouched: the edited version 2 still exists unchanged.
    const versions = await api.call('GET', `/api/v1/pages/${pageId}/versions`);
    const list = await jsonOf<{ versions: Array<{ versionNumber: number }> }>(versions);
    expect(list.versions.map((v) => v.versionNumber)).toEqual([1, 2, 3]);

    const two = await api.call('GET', `/api/v1/pages/${pageId}/versions/2`);
    const v2 = await jsonOf<{ version: { content: { page: { title: string } } } }>(two);
    expect(v2.version.content.page.title).toBe('Agence Vitrine — version éditée');
  });
});