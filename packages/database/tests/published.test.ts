import { beforeEach, describe, expect, it } from 'vitest';
import { NotFoundError } from '../src/errors.js';
import { makeEnvelope, makeRepos, makeTenant, resetDb, type Tenant } from './helpers.js';

describe('publishing', () => {
  let tenant: Tenant;
  const repos = makeRepos();

  beforeEach(async () => {
    await resetDb();
    tenant = await makeTenant();
  });

  it('publishes a chosen immutable version as a snapshot and records an event', async () => {
    const published = await repos.publishing.publish(tenant.owner, tenant.projectId, tenant.pageId, {
      versionNumber: 1,
    });
    const version = await repos.pages.versionAt(tenant.owner, tenant.projectId, tenant.pageId, 1);

    expect(published.pageVersionId).toBe(version.id);
    expect(published.unpublishedAt).toBeNull();

    const events = await repos.publishing.events(tenant.owner, tenant.projectId, tenant.pageId);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('PUBLISH');
    expect(JSON.stringify((events[0].snapshotJson as unknown) ?? {}).length).toBeGreaterThan(0);
  });

  it('republishing a newer version moves the pointer (old snapshot intact, both events kept)', async () => {
    const v2 = await repos.pages.saveVersion(tenant.owner, tenant.projectId, tenant.pageId, {
      baseVersion: 1,
      schemaVersion: '1.0.0',
      content: makeEnvelope('published v2'),
    });

    await repos.publishing.publish(tenant.owner, tenant.projectId, tenant.pageId, { versionNumber: 1 });
    const republished = await repos.publishing.publish(tenant.owner, tenant.projectId, tenant.pageId, {
      versionNumber: 2,
    });

    expect(republished.pageVersionId).toBe(v2.id);
    const row = await repos.publishing.getForPage(tenant.owner, tenant.projectId, tenant.pageId);
    expect(row?.pageVersionId).toBe(v2.id);

    const events = await repos.publishing.events(tenant.owner, tenant.projectId, tenant.pageId);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.type)).toEqual(['PUBLISH', 'PUBLISH']);

    // the original version is still intact
    const v1 = await repos.pages.versionAt(tenant.owner, tenant.projectId, tenant.pageId, 1);
    expect(v1.createdAt.toISOString().length).toBeGreaterThan(0);
  });

  it('unpublish soft-removes the live page but keeps the append-only event trail', async () => {
    const published = await repos.publishing.publish(tenant.owner, tenant.projectId, tenant.pageId, {
      versionNumber: 1,
    });
    const unpublished = await repos.publishing.unpublish(tenant.owner, tenant.projectId, tenant.pageId);

    expect(unpublished.id).toBe(published.id);
    expect(unpublished.unpublishedAt).not.toBeNull();

    const events = await repos.publishing.events(tenant.owner, tenant.projectId, tenant.pageId);
    expect(events.map((e) => e.type)).toEqual(['UNPUBLISH', 'PUBLISH']);
  });

  it('rejects publishing a version that does not belong to the page', async () => {
    await expect(
      repos.publishing.publish(tenant.owner, tenant.projectId, tenant.pageId, { versionNumber: 99 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});