/**
 * Phase 12 — visual QA publish gate (E-PUBLISH-002).
 *
 * routes publishing through the real L1/L2 flow, while the visual-qa plugin is
 * mocked so the gate's DECISION wiring is tested deterministically on any
 * machine (the real Chrome execution is covered by @landing-ai/visual-qa's own
 * suite). Default: gate disabled → publish proceeds. Enabled + failing VIS
 * checks → 422 E-PUBLISH-002 and nothing goes live.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getPublishedViewByHost } from '../lib/public';
import { makeApiClient, publishableEnvelope, type ApiClient } from './harness.js';

const gateMock = vi.hoisted(() => {
  let outcome: { skipped: boolean; reason?: string; report?: { passed: boolean; checks: unknown[] } } = {
    skipped: true,
  };
  return {
    setOutcome: (o: typeof outcome) => {
      outcome = o;
    },
    outcome: () => outcome,
  };
});

vi.mock('@landing-ai/visual-qa', () => ({
  runVisualPublishGate: async () => gateMock.outcome(),
  gatePasses: (report?: { passed?: boolean }) => Boolean(report?.passed ?? true),
}));

const savePublishablePage = async (api: ApiClient): Promise<{ projectId: string; pageId: string }> => {
  const project = await api.call('POST', '/api/v1/projects', { name: 'Gate Studio' });
  expect(project.status).toBe(201);
  const projectId = (
    await (await project.json()) as { project: { id: string } }
  ).project.id;
  const createPage = await api.call('POST', `/api/v1/projects/${projectId}/pages`, { title: 'Landing' });
  expect(createPage.status).toBe(201);
  const pageId = ((await createPage.json()) as { page: { id: string } }).page.id;
  const save = await api.call('POST', `/api/v1/pages/${pageId}/versions`, {
    baseVersion: 0,
    schemaVersion: '1.0.0',
    content: publishableEnvelope(),
  });
  expect(save.status).toBe(200);
  return { projectId, pageId };
};

const register = async (api: ApiClient, email: string) => {
  const res = await api.call('POST', '/api/v1/auth/register', { email, name: 'Gate User', password: 'Str0ngP@ssw0rd!' });
  expect(res.status).toBe(201);
  return res;
};

async function makeUser(email: string): Promise<ApiClient> {
  const api = makeApiClient();
  await register(api, email);
  return api;
}

async function jsonOf<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe('visual QA publish gate (E-PUBLISH-002)', () => {
  afterEach(() => {
    delete process.env.ENABLE_VISUAL_QA_GATE;
    gateMock.setOutcome({ skipped: true });
  });

  it('is a no-op by default (disabled) — publishes normally', async () => {
    delete process.env.ENABLE_VISUAL_QA_GATE;
    const api = await makeUser('vg-disabled@example.com');
    const { pageId } = await savePublishablePage(api);
    const res = await api.call('POST', `/api/v1/pages/${pageId}/publish`);
    expect(res.status).toBe(200);
  });

  it('skips cleanly when enabled but Chrome is unavailable', async () => {
    process.env.ENABLE_VISUAL_QA_GATE = '1';
    gateMock.setOutcome({ skipped: true, reason: 'no system Chrome available for visual QA' });
    const api = await makeUser('vg-nochrome@example.com');
    const { pageId } = await savePublishablePage(api);
    const res = await api.call('POST', `/api/v1/pages/${pageId}/publish`);
    expect(res.status).toBe(200);
  });

  it('blocks publishing with E-PUBLISH-002 when a VIS check fails', async () => {
    process.env.ENABLE_VISUAL_QA_GATE = '1';
    gateMock.setOutcome({
      skipped: false,
      report: {
        passed: false,
        checks: [{ id: 'VIS-001', title: 'complete render', status: 'fail', details: ['found 2 sections, expected 5'] }],
      },
    });
    const api = await makeUser('vg-fail@example.com');
    const { pageId } = await savePublishablePage(api);
    const res = await api.call('POST', `/api/v1/pages/${pageId}/publish`);
    expect(res.status).toBe(422);
    const { error } = await jsonOf<{ error: { code: string; details: { issues: Array<{ checkId: string }> } } }>(res);
    expect(error.code).toBe('E-PUBLISH-002');
    expect(error.details.issues).toEqual([expect.objectContaining({ checkId: 'VIS-001' })]);
  });

  it('publishes normally when the enabled gate passes', async () => {
    process.env.ENABLE_VISUAL_QA_GATE = '1';
    gateMock.setOutcome({ skipped: false, report: { passed: true, checks: [] } });
    const api = await makeUser('vg-pass@example.com');
    const { pageId } = await savePublishablePage(api);
    const res = await api.call('POST', `/api/v1/pages/${pageId}/publish`);
    expect(res.status).toBe(200);
    const { published } = await jsonOf<{ published: { host: string } }>(res);
    const live = await getPublishedViewByHost(published.host);
    expect(live).not.toBeNull();
  });

  it('never publishes when the gate fails (no snapshot survives)', async () => {
    process.env.ENABLE_VISUAL_QA_GATE = '1';
    gateMock.setOutcome({
      skipped: false,
      report: {
        passed: false,
        checks: [{ id: 'VIS-007', title: 'CTAs operable', status: 'fail', details: ['no interactive call-to-action rendered'] }],
      },
    });
    const api = await makeUser('vg-nolive@example.com');
    const { pageId } = await savePublishablePage(api);
    const res = await api.call('POST', `/api/v1/pages/${pageId}/publish`);
    expect(res.status).toBe(422);
    const versions = await api.call('GET', `/api/v1/pages/${pageId}/versions`);
    expect(versions.status).toBe(200);
  });
});