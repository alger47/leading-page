import { beforeEach, describe, expect, it } from 'vitest';
import { OptimisticConcurrencyError } from '../src/errors.js';
import { makeEnvelope, makeRepos, makeTenant, resetDb, type Tenant } from './helpers.js';

/**
 * Optimistic concurrency (§10.2): when two clients save from the same base
 * version, exactly one wins and the other receives an explicit conflict —
 * no lost update, no gap in the version sequence.
 */
describe('optimistic concurrency', () => {
  let tenant: Tenant;
  const repos = makeRepos();

  beforeEach(async () => {
    await resetDb();
    tenant = await makeTenant();
    // tenant fixture already created version #1; bring latest to #2
    await repos.pages.saveVersion(tenant.owner, tenant.projectId, tenant.pageId, {
      baseVersion: 1,
      schemaVersion: '1.0.0',
      content: makeEnvelope('base draft'),
    });
  });

  it('exactly one of two concurrent saves from the same base succeeds', async () => {
    const results = await Promise.allSettled([
      repos.pages.saveVersion(tenant.owner, tenant.projectId, tenant.pageId, {
        baseVersion: 2,
        schemaVersion: '1.0.0',
        content: makeEnvelope('writer A'),
      }),
      repos.pages.saveVersion(tenant.owner, tenant.projectId, tenant.pageId, {
        baseVersion: 2,
        schemaVersion: '1.0.0',
        content: makeEnvelope('writer B'),
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const winner = fulfilled[0] as PromiseFulfilledResult<{ versionNumber: number }>;
    expect(winner.value.versionNumber).toBe(3);
    const loser = rejected[0] as PromiseRejectedResult;
    expect(loser.reason).toBeInstanceOf(OptimisticConcurrencyError);

    // a single consistent version sequence 1,2,3 — the losing writer left no row
    const versions = await repos.pages.listVersions(tenant.owner, tenant.projectId, tenant.pageId);
    expect(versions.map((v) => v.versionNumber)).toEqual([1, 2, 3]);
  });

  it('subsequent writes chain off the new latest version', async () => {
    await repos.pages.saveVersion(tenant.owner, tenant.projectId, tenant.pageId, {
      baseVersion: 2,
      schemaVersion: '1.0.0',
      content: makeEnvelope('v3'),
    });
    const v4 = await repos.pages.saveVersion(tenant.owner, tenant.projectId, tenant.pageId, {
      baseVersion: 3,
      schemaVersion: '1.0.0',
      content: makeEnvelope('v4'),
    });
    expect(v4.versionNumber).toBe(4);
  });
});