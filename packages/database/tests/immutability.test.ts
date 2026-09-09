import { beforeEach, describe, expect, it } from 'vitest';
import { makeEnvelope, makeRepos, makeTenant, resetDb, type Tenant } from './helpers.js';

/**
 * Version immutability (§10.2): a new version is always a new row; history is
 * never overwritten. "Restore" creates a new version instead of an in-place
 * rewrite.
 */
describe('page version immutability', () => {
  let tenant: Tenant;
  const repos = makeRepos();

  beforeEach(async () => {
    await resetDb();
    tenant = await makeTenant();
  });

  it('creates monotonic versions as new rows, never rewriting older rows', async () => {
    const v1 = await repos.pages.versionAt(tenant.owner, tenant.projectId, tenant.pageId, 1);

    const v2 = await repos.pages.saveVersion(tenant.owner, tenant.projectId, tenant.pageId, {
      baseVersion: 1,
      schemaVersion: '1.0.0',
      content: makeEnvelope('immutable v2'),
    });
    expect(v2.versionNumber).toBe(2);

    const versions = await repos.pages.listVersions(tenant.owner, tenant.projectId, tenant.pageId);
    expect(versions.map((v) => v.versionNumber)).toEqual([1, 2]);

    // v1 is intact after v2 was created
    const v1After = await repos.pages.versionAt(tenant.owner, tenant.projectId, tenant.pageId, 1);
    expect(v1After.contentJson).toEqual(v1.contentJson);
    expect(v1After.createdAt.toISOString()).toBe(v1.createdAt.toISOString());
  });

  it('restore creates a new version (copy of the target) and never rewrites history', async () => {
    const v1 = await repos.pages.versionAt(tenant.owner, tenant.projectId, tenant.pageId, 1);
    const targetContent = v1.contentJson;

    await repos.pages.saveVersion(tenant.owner, tenant.projectId, tenant.pageId, {
      baseVersion: 1,
      schemaVersion: '1.0.0',
      content: makeEnvelope('current draft'),
    });
    // restore v1 -> new v3
    const restored = await repos.pages.saveVersion(tenant.owner, tenant.projectId, tenant.pageId, {
      baseVersion: 2,
      schemaVersion: '1.0.0',
      content: targetContent as never,
    });
    expect(restored.versionNumber).toBe(3);

    const versions = await repos.pages.listVersions(tenant.owner, tenant.projectId, tenant.pageId);
    expect(versions.map((v) => v.versionNumber)).toEqual([1, 2, 3]);
    expect(versions[2].contentJson).toEqual(versions[0].contentJson);
    // the intermediate version is untouched
    expect(versions[1].contentJson).toEqual(makeEnvelope('current draft'));
  });

  it('rejects a base version that does not match the current latest (no silent overwrite)', async () => {
    // latest is 1; a client that read an older snapshot (base 0) must be rejected
    const { OptimisticConcurrencyError } = await import('../src/errors.js');
    await expect(
      repos.pages.saveVersion(tenant.owner, tenant.projectId, tenant.pageId, {
        baseVersion: 0,
        schemaVersion: '1.0.0',
        content: makeEnvelope('stale'),
      }),
    ).rejects.toBeInstanceOf(OptimisticConcurrencyError);
  });
});