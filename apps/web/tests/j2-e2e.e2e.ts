/**
 * Acceptance J2 — section-only regeneration e2e against the REAL engine +
 * REAL worker (Phase 8):
 *   auth → project → page → GENERATE (full pipeline, version 1) →
 *   POST /pages/:id/sections/:sectionId/regenerate → the worker enqueues a
 *   SECTION job → the real engine rebuilds ONLY the target section over the
 *   current draft and splices it back → web persists the spliced document as
 *   version 2.
 *
 * Invariant under test: every section EXCEPT the target is byte-identical to
 * version 1; the target keeps its id/type/variant and the new document is
 * L1-valid (a version is only persisted through saveVersion's L1 gate).
 *
 * Same seams as J1: local test Postgres, in-memory queue driver, stub provider.
 * Skipped automatically when apps/ai-engine/.venv is absent (dev-only).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenerationService, setGenerationServiceFactory } from '../lib/generation-service';
import { HttpWorkerClient } from '../lib/worker-client';
import { makeApiClient, type ApiClient, waitFor } from './harness.js';
import { engineVenvAvailable, startRealWorkerBridge, WORKER_TOKEN } from './e2e/worker-bridge.js';

const BRIEF = 'Une agence digitale qui bâtit des sites vitrine élégants : page de garde, services, témoignages, contact.';
const LOCALE = 'fr' as const;
const TONE = 'warm-professional';

async function jsonOf<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

interface PageDetail {
  page: {
    page: { versionCount: number };
    latestVersion: { versionNumber: number; content: { schemaVersion: string; page: { title: string }; sections: Array<Record<string, unknown>> } } | null;
  };
}

async function pageDetail(api: ApiClient, pageId: string): Promise<PageDetail> {
  return jsonOf(await api.call('GET', `/api/v1/pages/${pageId}`));
}

describe.skipIf(!engineVenvAvailable())('J2 section regeneration e2e (real engine + real worker)', () => {
  let api: ApiClient;
  let projectId: string;
  let pageId: string;
  let fullJobId: string;
  let bridge: Awaited<ReturnType<typeof startRealWorkerBridge>>;

  async function scheduleGenerate(): Promise<string> {
    const created = await api.call('POST', '/api/v1/generate', { projectId, pageId, brief: BRIEF, locale: LOCALE, tone: TONE });
    expect(created.status).toBe(202);
    const id = (await jsonOf<{ jobId: string }>(created)).jobId;
    // Enqueue is committed in the web DB; only now let the worker drain (the
    // memory driver races the web's store.put() otherwise). The worker stays
    // resumed for the whole suite, so later SECTION jobs process on their own.
    await bridge.resume();
    await waitFor(async () => {
      const res = await api.call('GET', `/api/v1/generation-jobs/${id}`);
      return (await jsonOf<{ job?: { status: string } }>(res)).job?.status === 'COMPLETED';
    });
    return id;
  }

  beforeAll(async () => {
    bridge = await startRealWorkerBridge();
    setGenerationServiceFactory(() => new GenerationService({ worker: new HttpWorkerClient(bridge.workerBaseUrl, WORKER_TOKEN) }));
    api = makeApiClient();
    const reg = await api.call('POST', '/api/v1/auth/register', { email: 'j2-e2e@example.com', name: 'J2 User', password: 'Str0ngP@ssw0rd!' });
    expect(reg.status).toBe(201);

    const project = await api.call('POST', '/api/v1/projects', { name: 'Agence Vitrine J2' });
    projectId = (await jsonOf<{ project: { id: string } }>(project)).project.id;

    const page = await api.call('POST', `/api/v1/projects/${projectId}/pages`, { title: 'Landing' });
    pageId = (await jsonOf<{ page: { id: string } }>(page)).page.id;

    fullJobId = await scheduleGenerate();
  });

  afterAll(async () => {
    setGenerationServiceFactory(null);
    await bridge?.close();
  });

  it('full generation produced version 1 with a hero among the sections', async () => {
    const v1 = await pageDetail(api, pageId);
    expect(v1.page.latestVersion).not.toBeNull();
    expect(v1.page.latestVersion!.versionNumber).toBe(1);
    const hero = v1.page.latestVersion!.content.sections.find((s) => s.type === 'hero');
    expect(hero).toBeDefined();
  });

  it('regenerating the hero leaves every other section byte-identical (version 2)', async () => {
    const before = await pageDetail(api, pageId);
    const v1 = before.page.latestVersion!.content;
    const heroId = (v1.sections.find((s) => s.type === 'hero') as { id: string }).id;

    const regen = await api.call('POST', `/api/v1/pages/${pageId}/sections/${heroId}/regenerate`);
    expect(regen.status).toBe(202);
    const regenJobId = (await jsonOf<{ job: { jobId: string } }>(regen)).job.jobId;
    expect(regenJobId).not.toBe(fullJobId);

    await waitFor(async () => {
      const res = await api.call('GET', `/api/v1/generation-jobs/${regenJobId}`);
      return (await jsonOf<{ job?: { status: string } }>(res)).job?.status === 'COMPLETED';
    }, 120_000);

    const after = await pageDetail(api, pageId);
    expect(after.page.page.versionCount).toBe(2);
    const v2 = after.page.latestVersion!.content;
    expect(after.page.latestVersion!.versionNumber).toBe(2);

    expect(v2.sections).toHaveLength(v1.sections.length);
    const indexById = (doc: typeof v1, id: string) => doc.sections.findIndex((s) => (s as { id: string }).id === id);
    const heroIndex = indexById(v2, heroId);
    expect(heroIndex).toBeGreaterThanOrEqual(0);

    // Byte-identical EVERYWHERE except the (possibly rewritten) hero.
    for (let i = 0; i < v1.sections.length; i += 1) {
      if (i === heroIndex) continue;
      expect(v2.sections[i]).toEqual(v1.sections[i]);
    }

    // The hero keeps its identity; its content is a full, L1-valid slot set.
    const heroV1 = v1.sections[indexById(v1, heroId)] as { type: string; variant: string; content: Record<string, unknown> };
    const heroV2 = v2.sections[heroIndex] as { type: string; variant: string; content: Record<string, unknown> };
    expect(heroV2.type).toBe(heroV1.type);
    expect(heroV2.variant).toBe(heroV1.variant);
    expect(typeof heroV2.content).toBe('object');
    expect(Object.keys(heroV2.content).length).toBeGreaterThan(0);
  });
});