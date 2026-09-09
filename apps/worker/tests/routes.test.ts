import { describe, it, expect, afterEach } from 'vitest';

import { enqueue } from '../src/jobs/enqueue.js';
import { makeHarness, type Harness } from './harness.js';

const active: Harness[] = [];
afterEach(async () => {
  await Promise.all(active.splice(0).map((h) => h.close()));
});

async function newHarness(opts: Parameters<typeof makeHarness>[0] = {}): Promise<Harness> {
  const h = await makeHarness(opts);
  active.push(h);
  return h;
}

const BRIEF = 'عيادة بيطرية في الجزائر، مواعيد دقيقة.';

describe('worker API routes', () => {
  it('validates the request body and returns the error envelope', async () => {
    const h = await newHarness({ includeWorker: false });

    const missing = await h.app.inject({ method: 'POST', url: '/api/jobs', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({}) });
    expect(missing.statusCode).toBe(400);
    const envelope = missing.json<{ error: { code: string; message: string; docs: string } }>();
    expect(envelope.error.code).toBe('E-VAL-REQ-001');
    expect(envelope.error.message.length).toBeGreaterThan(0);
    expect(envelope.error.docs).toMatch(/^\/docs\/errors\//);

    const badLocale = await h.app.inject({ method: 'POST', url: '/api/jobs', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ brief: 'x', locale: 'xx' }) });
    expect(badLocale.statusCode).toBe(400);

    const emptyBrief = await h.app.inject({ method: 'POST', url: '/api/jobs', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ brief: '' }) });
    expect(emptyBrief.statusCode).toBe(400);
  });

  it('issues a location header and returns QUEUED on creation', async () => {
    const h = await newHarness({ includeWorker: false });
    const res = await h.app.inject({ method: 'POST', url: '/api/jobs', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ brief: BRIEF, budgetUsd: 0.05 }) });
    expect(res.statusCode).toBe(202);
    expect(res.headers.location).toMatch(/^\/api\/jobs\/gen_/);
    const { status } = res.json<{ status: string }>();
    expect(status).toBe('QUEUED');
  });

  it('returns 404 with the envelope for unknown jobs', async () => {
    const h = await newHarness({ includeWorker: false });
    const res = await h.app.inject({ method: 'GET', url: '/api/jobs/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('E-JOB-NOT-FOUND');
  });

  it('refuses to cancel a terminal job (E-JOB-003)', async () => {
    const h = await newHarness({ includeWorker: false });
    const made = await enqueue(h, { brief: BRIEF }, 'terminal-key');
    made.record.status = 'COMPLETED';
    const res = await h.app.inject({ method: 'DELETE', url: `/api/jobs/${made.record.id}` });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('E-JOB-003');
  });

  it('exposes healthz and spans endpoints', async () => {
    const h = await newHarness({ includeWorker: false });
    const health = await h.app.inject({ method: 'GET', url: '/healthz' });
    expect(health.statusCode).toBe(200);
    const body = health.json<{ service: string; engine: { reachable: boolean } }>();
    expect(body.service).toBe('worker');
    expect(body.engine.reachable).toBe(true);

    const made = await enqueue(h, { brief: BRIEF }, 'span-key');
    const spans = await h.app.inject({ method: 'GET', url: `/api/jobs/${made.record.id}/spans` });
    expect(spans.statusCode).toBe(200);
    expect(spans.json<{ traceId: string; spans: unknown[] }>().spans).toEqual([]);
  });
});