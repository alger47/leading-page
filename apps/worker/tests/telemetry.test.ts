import { describe, it, expect, afterEach } from 'vitest';

import { makeHarness, waitFor, type Harness } from './harness.js';

const active: Harness[] = [];
afterEach(async () => {
  await Promise.all(active.splice(0).map((h) => h.close()));
});

async function newHarness(opts: Parameters<typeof makeHarness>[0] = {}): Promise<Harness> {
  const h = await makeHarness(opts);
  active.push(h);
  return h;
}

const BRIEF = 'عيادة بيطرية، مواعيد، رعاية القطط والكلاب.';

describe('telemetry spans', () => {
  it('records a job.process root span with an engine.generate child', async () => {
    const h = await newHarness({ scenario: { mode: 'ok' } });

    const created = await h.app.inject({ method: 'POST', url: '/api/jobs', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ brief: BRIEF }) });
    const jobId = created.json<{ jobId: string }>().jobId;

    await h.resumeWorker();
    await waitFor(async () => h.store.get(jobId)?.status === 'COMPLETED');

    const record = h.store.get(jobId)!;
    const spans = h.spans.spansForTrace(record.traceId);
    expect(spans.map((s) => s.name).sort()).toEqual(['engine.generate', 'job.process']);

    const root = spans.find((s) => s.name === 'job.process')!;
    const child = spans.find((s) => s.name === 'engine.generate')!;
    expect(root.status).toBe('ok');
    expect(child.parentId).toBe(root.spanId);
    expect(child.attributes['job.id']).toBe(jobId);
    expect(child.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('marks spans failed on transient exhaustion and carries the retriable flag', async () => {
    const h = await newHarness({ scenario: { mode: 'transient', transientRemaining: 99 }, maxAttempts: 2 });

    const created = await h.app.inject({ method: 'POST', url: '/api/jobs', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ brief: BRIEF }) });
    const jobId = created.json<{ jobId: string }>().jobId;

    await h.resumeWorker();
    await waitFor(async () => h.store.get(jobId)?.status === 'FAILED');

    const record = h.store.get(jobId)!;
    const spans = h.spans.spansForTrace(record.traceId);
    const root = spans.find((s) => s.name === 'job.process')!;
    const engineSpans = spans.filter((s) => s.name === 'engine.generate');

    expect(engineSpans).toHaveLength(2);
    for (const span of engineSpans) {
      expect(span.status).toBe('error');
      expect(span.errorCode).toBe('E-JOB-001');
      expect(span.attributes.retryable).toBe(true);
    }
    expect(root.status).toBe('error');
    expect(root.errorCode).toBe('E-JOB-001');
  });
});