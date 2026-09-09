import { beforeEach, describe, expect, it } from 'vitest';
import { NotFoundError } from '../src/errors.js';
import { makeRepos, makeTenant, resetDb, type Tenant } from './helpers.js';

/**
 * Tenant isolation matrix (normative §10.5): every repository call is bound
 * to an owner; querying or mutating another tenant's rows must fail with
 * NotFoundError — "frontend hiding is not authorization".
 */
describe('tenant isolation', () => {
  let a: Tenant;
  let b: Tenant;

  beforeEach(async () => {
    await resetDb();
    a = await makeTenant();
    b = await makeTenant();
  });

  it('projects are scoped by owner', async () => {
    const repos = makeRepos();
    await expect(repos.projects.get(a.owner, b.projectId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(repos.projects.get(b.owner, a.projectId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(repos.projects.update(b.owner, a.projectId, { name: 'hijack' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(repos.projects.archive(b.owner, a.projectId)).rejects.toBeInstanceOf(NotFoundError);

    const listA = await repos.projects.list(a.owner);
    expect(listA.map((p) => p.id)).toEqual([a.projectId]);
  });

  it('pages and versions are scoped by the project ownership chain', async () => {
    const repos = makeRepos();
    await expect(repos.pages.get(b.owner, b.projectId, a.pageId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(repos.pages.list(b.owner, a.projectId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(repos.pages.saveVersion(b.owner, b.projectId, a.pageId, { baseVersion: 1, schemaVersion: '1.0.0', content: {} as never })).rejects.toBeInstanceOf(NotFoundError);
    await expect(repos.pages.listVersions(b.owner, b.projectId, a.pageId)).rejects.toBeInstanceOf(NotFoundError);

    const version = await repos.pages.saveVersion(a.owner, a.projectId, a.pageId, {
      baseVersion: 1,
      schemaVersion: '1.0.0',
      content: (await import('./helpers.js')).makeEnvelope('v2'),
    });
    expect(version.versionNumber).toBe(2);
  });

  it('generation jobs are scoped by the project ownership chain', async () => {
    const repos = makeRepos();
    await expect(repos.jobs.get(b.owner, b.projectId, a.jobId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(repos.jobs.get(a.owner, a.projectId, b.jobId)).rejects.toBeInstanceOf(NotFoundError);
    expect(await repos.jobs.getByKey(b.owner, b.projectId, `key-${seqOf(a)}`)).toBeNull();
    await expect(repos.jobs.transition(b.owner, b.projectId, a.jobId, { to: 'RUNNING' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(repos.jobs.recordAttempt(b.owner, b.projectId, a.jobId, { stage: 's', attempt: 1, outcome: 'SUCCESS' })).rejects.toBeInstanceOf(NotFoundError);

    const listA = await repos.jobs.list(a.owner, a.projectId);
    expect(listA).toHaveLength(1);
    expect(listA[0].id).toBe(a.jobId);
  });

  it('assets are scoped by the project ownership chain', async () => {
    const repos = makeRepos();
    await expect(repos.assets.get(b.owner, b.projectId, a.assetId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(repos.assets.remove(b.owner, b.projectId, a.assetId)).rejects.toBeInstanceOf(NotFoundError);
    expect((await repos.assets.list(a.owner, a.projectId)).map((x) => x.id)).toEqual([a.assetId]);
  });

  it('publishing and event trails are scoped by the project ownership chain', async () => {
    const repos = makeRepos();
    await expect(
      repos.publishing.publish(b.owner, b.projectId, a.pageId, { versionNumber: 1 }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(repos.publishing.publish(a.owner, a.projectId, b.pageId, { versionNumber: 1 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(repos.publishing.unpublish(b.owner, b.projectId, a.pageId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(repos.publishing.getForPage(b.owner, b.projectId, a.pageId)).resolves.toBeNull();
    await expect(repos.publishing.events(b.owner, b.projectId, a.pageId)).resolves.toHaveLength(0);
  });

  it('archived projects are excluded from active access', async () => {
    const repos = makeRepos();
    await repos.projects.archive(a.owner, a.projectId);
    await expect(repos.projects.get(a.owner, a.projectId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(repos.pages.get(a.owner, a.projectId, a.pageId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(repos.jobs.get(a.owner, a.projectId, a.jobId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(repos.projects.list(a.owner)).resolves.toHaveLength(0);
  });

  function seqOf(t: Tenant): string {
    return t.jobId.split('_')[1] ?? '?';
  }
});