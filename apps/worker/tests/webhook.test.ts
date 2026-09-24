/**
 * RT ج — background finalize webhook.
 *
 * 1) createWebhookNotifier: HTTP contract (POST to the web internal route,
 *    carries X-Internal-Token, retries once, never throws).
 * 2) Processor wiring: the worker nudges the web on every terminal state
 *    (COMPLETED / FAILED / CANCELLED) so the DB is reconciled without a
 *    browser poll.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { createWebhookNotifier, type TerminalStatus, type WebhookNotifier } from '../src/webhook.js';
import { makeHarness, type Harness } from './harness.js';

function spyNotifier(): { calls: Array<{ jobId: string; status: TerminalStatus }>; notifier: WebhookNotifier } {
  const calls: Array<{ jobId: string; status: TerminalStatus }> = [];
  const notifier: WebhookNotifier = {
    notify: async (jobId: string, status: TerminalStatus) => {
      calls.push({ jobId, status });
    },
  };
  return { calls, notifier };
}

const active: Harness[] = [];
afterEach(async () => {
  await Promise.all(active.splice(0).map((h) => h.close()));
});

async function newHarness(opts: Parameters<typeof makeHarness>[0] = {}): Promise<Harness> {
  const h = await makeHarness(opts);
  active.push(h);
  return h;
}

const BRIEF = 'site vitrine pour une clinique dentaire à Oran: accueil, soins, contact.';

describe('createWebhookNotifier', () => {
  it('POSTs to the web internal route with the shared internal token', async () => {
    const calls: Array<{ url: string; method: string; token: string | null; status: TerminalStatus | null }> = [];
    const captureFetch = ((url: string, init: RequestInit = {}) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      calls.push({
        url,
        method: init.method ?? 'GET',
        token: headers['x-internal-token'] ?? null,
        status: init.body ? (JSON.parse(init.body as string) as { status: TerminalStatus }).status : null,
      });
      return Promise.resolve({ status: 204 } as Response);
    }) as typeof fetch;

    const notifier = createWebhookNotifier({ baseUrl: 'https://web.example', token: 'shared-secret', fetchImpl: captureFetch });
    await notifier.notify('gen_abcdef', 'COMPLETED');

    expect(calls).toEqual([
      {
        url: 'https://web.example/api/internal/jobs/gen_abcdef/notify',
        method: 'POST',
        token: 'shared-secret',
        status: 'COMPLETED',
      },
    ]);
  });

  it('is best-effort: a refused webhook never throws (single immediate call + retry)', async () => {
    let attempts = 0;
    const failFetch = (async () => {
      attempts += 1;
      return { status: 500 } as Response;
    }) as unknown as typeof fetch;

    const notifier = createWebhookNotifier({ baseUrl: 'http://web.local', token: 't', fetchImpl: failFetch });
    await expect(notifier.notify('gen_xyz', 'FAILED')).resolves.toBeUndefined();
    expect(attempts).toBe(2);
  });

  it('stops at the first 2xx response (no wasted retry)', async () => {
    let attempts = 0;
    const okFirst = (async () => {
      attempts += 1;
      return { status: 200 } as Response;
    }) as unknown as typeof fetch;

    const notifier = createWebhookNotifier({ baseUrl: 'http://web.local', token: 't', fetchImpl: okFirst });
    await notifier.notify('gen_ok', 'COMPLETED');
    expect(attempts).toBe(1);
  });
});

describe('worker → web terminal webhook wiring', () => {
  it('notifies the web when a job COMPLETES', async () => {
    const { calls, notifier } = spyNotifier();
    const h = await newHarness({ scenario: { mode: 'ok' }, notify: notifier });

    const created = await h.app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'bg-finalize-ok' },
      payload: JSON.stringify({ brief: BRIEF, locale: 'fr' }),
    });
    const jobId = created.json<{ jobId: string }>().jobId;

    await h.resumeWorker();
    await h.app.inject({ method: 'GET', url: `/api/jobs/${jobId}` });
    // let the async processor settle (memory queue completes in a tick chain)
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(calls).toContainEqual({ jobId, status: 'COMPLETED' });
  });

  it('notifies the web when a job FAILS terminally', async () => {
    const { calls, notifier } = spyNotifier();
    const h = await newHarness({ scenario: { mode: 'business-fail' }, notify: notifier });

    const created = await h.app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'bg-finalize-fail' },
      payload: JSON.stringify({ brief: BRIEF }),
    });
    const jobId = created.json<{ jobId: string }>().jobId;

    await h.resumeWorker();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(calls).toContainEqual({ jobId, status: 'FAILED' });
  });

  it('notifies the web when a job is CANCELLED', async () => {
    const { calls, notifier } = spyNotifier();
    const h = await newHarness({ scenario: { mode: 'ok' }, notify: notifier });

    const created = await h.app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'bg-finalize-cancel' },
      payload: JSON.stringify({ brief: BRIEF }),
    });
    const jobId = created.json<{ jobId: string }>().jobId;

    const cancelled = await h.app.inject({ method: 'DELETE', url: `/api/jobs/${jobId}` });
    expect(cancelled.json<{ status: string }>().status).toBe('CANCELLED');

    expect(calls).toContainEqual({ jobId, status: 'CANCELLED' });
  });

  it('is a pure optimization: no notifier configured (dev/tests) → lifecycle unchanged', async () => {
    const h = await newHarness({ scenario: { mode: 'ok' } });
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'bg-finalize-noop' },
      payload: JSON.stringify({ brief: BRIEF }),
    });
    const jobId = created.json<{ jobId: string }>().jobId;
    await h.resumeWorker();
    const view = await h.app.inject({ method: 'GET', url: `/api/jobs/${jobId}` });
    expect(view.json<{ status: string }>().status).toBe('COMPLETED');
  });
});