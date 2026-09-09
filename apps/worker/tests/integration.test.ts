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

const BRIEF_AR = 'عيادة بيطرية في الجزائر العاصمة، مواعيد، رعاية للقطط والكلاب.';

describe('worker -> engine integration', () => {
  it('runs a job end-to-end and records the full lifecycle', async () => {
    const h = await newHarness({ scenario: { mode: 'ok' } });

    const created = await h.app.inject({ method: 'POST', url: '/api/jobs', headers: { 'content-type': 'application/json', 'idempotency-key': 'ar-vet-1' }, payload: JSON.stringify({ brief: BRIEF_AR, locale: 'ar', tone: 'warm-professional' }) });
    expect(created.statusCode).toBe(202);
    const { jobId, status } = created.json<{ jobId: string; status: string }>();
    expect(status).toBe('QUEUED');

    await h.resumeWorker();
    await waitFor(async () => (await h.app.inject({ method: 'GET', url: `/api/jobs/${jobId}` })).json<{ status: string }>().status === 'COMPLETED');

    const view = (await h.app.inject({ method: 'GET', url: `/api/jobs/${jobId}` })).json<{ status: string; result: Record<string, unknown>; engineStatus: string; attemptsMade: number }>();
    expect(view.status).toBe('COMPLETED');
    expect(view.engineStatus).toBe('COMPLETED');
    expect(view.attemptsMade).toBe(1);
    const result = view.result as {
      ledger: { cost_usd: number; attempts: number };
      page: { sections: unknown[] };
      page_validation: { valid: boolean };
    };
    expect(result.ledger.cost_usd).toBeGreaterThan(0);
    expect(result.page.sections).toHaveLength(5);
    expect(result.page_validation.valid).toBe(true);

    const events = (await h.app.inject({ method: 'GET', url: `/api/jobs/${jobId}/events` })).json<{ events: Array<{ type: string }> }>().events.map((e) => e.type);
    expect(events).toEqual([
      'job.queued',
      'job.started',
      'stage.brief_analyzed',
      'stage.page_planned',
      'stage.content_generated',
      'stage.schema_built',
      'stage.validated',
      'job.completed',
    ]);
  });

  it('replays the same Idempotency-Key instead of re-running', async () => {
    const h = await newHarness({ scenario: { mode: 'ok' } });

    const body = JSON.stringify({ brief: BRIEF_AR, locale: 'ar' });
    const first = await h.app.inject({ method: 'POST', url: '/api/jobs', headers: { 'content-type': 'application/json', 'idempotency-key': 'dup-key' }, payload: body });
    const second = await h.app.inject({ method: 'POST', url: '/api/jobs', headers: { 'content-type': 'application/json', 'idempotency-key': 'dup-key' }, payload: body });
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(200);
    expect(second.json<{ jobId: string }>().jobId).toBe(first.json<{ jobId: string }>().jobId);
    expect(h.fake!.calls).toHaveLength(0); // worker never started: replay only
  });

  it('rejects a different payload under the same Idempotency-Key (E-JOB-002)', async () => {
    const h = await newHarness({ scenario: { mode: 'ok' } });

    const first = await h.app.inject({ method: 'POST', url: '/api/jobs', headers: { 'content-type': 'application/json', 'idempotency-key': 'conflict-key' }, payload: JSON.stringify({ brief: BRIEF_AR }) });
    const second = await h.app.inject({ method: 'POST', url: '/api/jobs', headers: { 'content-type': 'application/json', 'idempotency-key': 'conflict-key' }, payload: JSON.stringify({ brief: 'a completely different brief for the same key' }) });
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(422);
    const envelope = second.json<{ error: { code: string } }>();
    expect(envelope.error.code).toBe('E-JOB-002');
  });

  it('retries transient 5xx errors then completes', async () => {
    const h = await newHarness({ scenario: { mode: 'transient', transientRemaining: 2 } });

    const created = await h.app.inject({ method: 'POST', url: '/api/jobs', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ brief: BRIEF_AR }) });
    const jobId = created.json<{ jobId: string }>().jobId;

    await h.resumeWorker();
    await waitFor(async () => h.store.get(jobId)?.status === 'COMPLETED');

    const record = h.store.get(jobId)!;
    expect(record.attemptsMade).toBe(3);
    const retried = record.events.filter((e) => e.type === 'job.retried');
    expect(retried).toHaveLength(2);
    expect(record.events.map((e) => e.type)).not.toContain('job.failed');
  });

  it('fails with E-JOB-001 after transient errors exhaust attempts', async () => {
    const h = await newHarness({ scenario: { mode: 'transient', transientRemaining: 99 }, maxAttempts: 2 });

    const created = await h.app.inject({ method: 'POST', url: '/api/jobs', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ brief: BRIEF_AR }) });
    const jobId = created.json<{ jobId: string }>().jobId;

    await h.resumeWorker();
    await waitFor(async () => h.store.get(jobId)?.status === 'FAILED');

    const record = h.store.get(jobId)!;
    expect(record.attemptsMade).toBe(2);
    expect(record.errorCode).toBe('E-JOB-001');
    const failed = record.events.find((e) => e.type === 'job.failed')!;
    expect(failed.code).toBe('E-JOB-001');
  });

  it('fails business failures immediately without retry (E-AI-001 / E-AI-005 / E-AI-002)', async () => {
    for (const scenario of [
      { mode: 'l0-reject' as const, code: 'E-AI-001' },
      { mode: 'business-fail' as const, code: 'E-AI-005' },
      { mode: 'budget-fail' as const, code: 'E-AI-002' },
    ]) {
      const h = await newHarness({ scenario: { mode: scenario.mode }, maxAttempts: 3 });
      const created = await h.app.inject({ method: 'POST', url: '/api/jobs', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ brief: BRIEF_AR }) });
      const jobId = created.json<{ jobId: string }>().jobId;

      await h.resumeWorker();
      await waitFor(async () => h.store.get(jobId)?.status === 'FAILED');

      const record = h.store.get(jobId)!;
      expect(record.attemptsMade).toBe(1); // no retry for business errors
      expect(record.errorCode).toBe(scenario.code);
      const failed = record.events.find((e) => e.type === 'job.failed')!;
      expect(failed.code).toBe(scenario.code);
      await h.close();
    }
  });

  it('fails with E-JOB-004 on a malformed engine response (no retry)', async () => {
    const h = await newHarness({ scenario: { mode: 'malformed' }, maxAttempts: 3 });

    const created = await h.app.inject({ method: 'POST', url: '/api/jobs', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ brief: BRIEF_AR }) });
    const jobId = created.json<{ jobId: string }>().jobId;

    await h.resumeWorker();
    await waitFor(async () => h.store.get(jobId)?.status === 'FAILED');

    const record = h.store.get(jobId)!;
    expect(record.attemptsMade).toBe(1);
    expect(record.errorCode).toBe('E-JOB-004');
  });

  it('fails with E-JOB-001 after repeated timeouts', async () => {
    const h = await newHarness({ scenario: { mode: 'timeout', delayMs: 200 }, maxAttempts: 2, engineTimeoutMs: 50, retryAfterMs: 10 });

    const created = await h.app.inject({ method: 'POST', url: '/api/jobs', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ brief: BRIEF_AR }) });
    const jobId = created.json<{ jobId: string }>().jobId;

    await h.resumeWorker();
    await waitFor(async () => h.store.get(jobId)?.status === 'FAILED');

    const record = h.store.get(jobId)!;
    expect(record.attemptsMade).toBe(2);
    expect(record.errorCode).toBe('E-JOB-001');
  });

  it('cancels a queued job (E-JOB-003) and never calls the engine', async () => {
    const h = await newHarness({ scenario: { mode: 'ok' } });

    const created = await h.app.inject({ method: 'POST', url: '/api/jobs', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ brief: BRIEF_AR }) });
    const jobId = created.json<{ jobId: string }>().jobId;

    const cancelled = await h.app.inject({ method: 'DELETE', url: `/api/jobs/${jobId}` });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json<{ status: string }>().status).toBe('CANCELLED');

    await h.resumeWorker();
    await new Promise((resolve) => setTimeout(resolve, 200));

    const record = h.store.get(jobId)!;
    expect(record.status).toBe('CANCELLED');
    expect(record.events.some((e) => e.type === 'job.cancelled' && e.code === 'E-JOB-003')).toBe(true);
    expect(h.fake!.calls).toHaveLength(0);
  });
});