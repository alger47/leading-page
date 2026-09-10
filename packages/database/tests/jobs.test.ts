import { beforeEach, describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError, StateTransitionError } from '../src/errors.js';
import { makeRepos, makeTenant, resetDb, type Tenant } from './helpers.js';

describe('generation jobs', () => {
  let tenant: Tenant;
  const repos = makeRepos();

  beforeEach(async () => {
    await resetDb();
    tenant = await makeTenant();
  });

  it('creates QUEUED jobs and finds them by idempotency key', async () => {
    const job = await repos.jobs.get(tenant.owner, tenant.projectId, tenant.jobId);
    expect(job.status).toBe('QUEUED');
    expect(job.idempotencyKey).toBe(`key-${tenant.jobId.split('_')[1]}`);
    expect(job.eventsJson).toEqual([]);
    expect(job.kind).toBe('FULL');
    expect(job.targetSectionId).toBeNull();

    const byKey = await repos.jobs.getByKey(tenant.owner, tenant.projectId, job.idempotencyKey);
    expect(byKey?.id).toBe(tenant.jobId);
  });

  it('persists SECTION regeneration jobs with their target section', async () => {
    const regen = await repos.jobs.create(tenant.owner, tenant.projectId, {
      id: `gen_regen_${Date.now()}`,
      label: 'regen hero',
      brief: 'context brief',
      requestJson: { brief: 'context brief', targetSectionId: tenant.jobId.split('_')[1] },
      idempotencyKey: `key-regen-${Date.now()}`,
      fingerprint: 'f',
      traceId: 't',
      kind: 'SECTION',
      targetSectionId: 'hero-01',
      pageId: tenant.pageId,
    });
    expect(regen.kind).toBe('SECTION');
    expect(regen.targetSectionId).toBe('hero-01');
  });

  it('rejects a duplicate idempotency key (dedupe at the database layer)', async () => {
    await expect(
      repos.jobs.create(tenant.owner, tenant.projectId, {
        id: `gen_other_${Date.now()}`,
        label: 'dup',
        brief: 'b',
        requestJson: { brief: 'b' },
        idempotencyKey: `key-${tenant.jobId.split('_')[1]}`,
        fingerprint: 'different',
        traceId: 't',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('walks the happy-path state machine and appends stable events', async () => {
    const queued = await repos.jobs.get(tenant.owner, tenant.projectId, tenant.jobId);
    expect(queued.eventsJson).toEqual([]);

    const running = await repos.jobs.transition(tenant.owner, tenant.projectId, tenant.jobId, {
      from: 'QUEUED',
      to: 'RUNNING',
      fields: { engineJobId: 'eng-1', startedAt: new Date() },
      event: { type: 'job.started', at: new Date().toISOString() },
    });
    expect(running.status).toBe('RUNNING');
    expect((running.eventsJson as Array<{ type: string }>).map((e) => e.type)).toEqual(['job.started']);

    const done = await repos.jobs.transition(tenant.owner, tenant.projectId, tenant.jobId, {
      from: 'RUNNING',
      to: 'COMPLETED',
      fields: { resultJson: { page: {} }, completedAt: new Date() },
      event: { type: 'job.completed', at: new Date().toISOString() },
    });
    expect(done.status).toBe('COMPLETED');
    expect((done.eventsJson as Array<{ type: string }>).map((e) => e.type)).toEqual(['job.started', 'job.completed']);
  });

  it('enforces the state machine and locks terminal statuses', async () => {
    // illegal transition (QUEUED may fast-path to RUNNING/VALIDATING/COMPLETED,
    // but never straight to RENDERING — that requires the engine pipeline)
    await expect(
      repos.jobs.transition(tenant.owner, tenant.projectId, tenant.jobId, { to: 'RENDERING' }),
    ).rejects.toBeInstanceOf(StateTransitionError);

    // from-mismatch
    await repos.jobs.transition(tenant.owner, tenant.projectId, tenant.jobId, { from: 'QUEUED', to: 'CANCELLED' });
    // terminal is final
    await expect(
      repos.jobs.transition(tenant.owner, tenant.projectId, tenant.jobId, { from: 'CANCELLED', to: 'RUNNING' }),
    ).rejects.toBeInstanceOf(StateTransitionError);
  });

  it('records attempts idempotently per (stage, attempt)', async () => {
    await repos.jobs.transition(tenant.owner, tenant.projectId, tenant.jobId, { to: 'RUNNING', fields: { attemptsMade: 1 } });

    const input = { stage: 'content-generator', attempt: 1, provider: 'openai', model: 'gpt-x', costUsd: 0.012, outcome: 'SUCCESS' as const };
    await repos.jobs.recordAttempt(tenant.owner, tenant.projectId, tenant.jobId, input);
    await repos.jobs.recordAttempt(tenant.owner, tenant.projectId, tenant.jobId, input); // replay

    const attempts = await repos.jobs.attempts(tenant.owner, tenant.projectId, tenant.jobId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].costUsd?.toString()).toBe('0.012');
  });

  it('lists jobs by project and status', async () => {
    const job = await repos.jobs.create(tenant.owner, tenant.projectId, {
      id: `gen_second_${Date.now()}`,
      label: 'second',
      brief: 'b2',
      requestJson: { brief: 'b2' },
      idempotencyKey: `key-second-${Date.now()}`,
      fingerprint: 'f',
      traceId: 't',
    });
    await repos.jobs.transition(tenant.owner, tenant.projectId, job.id, { from: 'QUEUED', to: 'RUNNING' });
    await repos.jobs.transition(tenant.owner, tenant.projectId, job.id, { from: 'RUNNING', to: 'COMPLETED' });

    const queued = await repos.jobs.list(tenant.owner, tenant.projectId, { status: 'QUEUED' });
    expect(queued.map((j) => j.id)).toEqual([tenant.jobId]);
    const completed = await repos.jobs.list(tenant.owner, tenant.projectId, { status: 'COMPLETED' });
    expect(completed.map((j) => j.id)).toEqual([job.id]);
    expect(await repos.jobs.list(tenant.owner, tenant.projectId)).toHaveLength(2);

    await expect(
      repos.jobs.get({ userId: 'someone-else' }, tenant.projectId, tenant.jobId),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});