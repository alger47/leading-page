import { describe, it, expect } from 'vitest';
import { prisma } from './helpers.js';

const EXPECTED_TABLES = [
  'user',
  'project',
  'page',
  'page_version',
  'asset',
  'generation_job',
  'generation_attempt',
  'subdomain',
  'published_page',
  'publication_event',
  'prompt_version',
];

/**
 * Acceptance: "migrations run clean". globalSetup already replayed every
 * forward-only migration on a fresh schema; here we introspect the result.
 */
describe('migrations', () => {
  it('applies every migration cleanly and creates the full entity model', async () => {
    const applied = await prisma.$queryRawUnsafe<Array<{ migration_name: string; finished_at: Date | null }>>(
      'SELECT migration_name, finished_at FROM _prisma_migrations WHERE rolled_back_at IS NULL ORDER BY started_at',
    );
    expect(applied.length).toBeGreaterThanOrEqual(2);
    for (const row of applied) expect(row.finished_at).not.toBeNull();

    const tables = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    const names = tables.map((t) => t.tablename);
    for (const table of EXPECTED_TABLES) expect(names).toContain(table);
  });

  it('enforces the §10.2 constraints and indexes along the ownership chain', async () => {
    // Prisma's `@unique` emits CREATE UNIQUE INDEX — introspect pg_indexes.
    const indexes = await prisma.$queryRawUnsafe<Array<{ indexname: string; indexdef: string }>>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`,
    );
    const names = indexes.map((i) => i.indexname);
    const unique = indexes.filter((i) => i.indexdef.includes('UNIQUE')).map((i) => i.indexname);

    // unique (page_id, version_number)
    expect(unique).toContain('page_version_pageId_versionNumber_key');
    // unique idempotency key — multi-instance dedupe guarantee
    expect(unique).toContain('generation_job_idempotencyKey_key');
    // unique (stage, version) prompt registry
    expect(unique).toContain('prompt_version_stage_version_key');
    // unique published snapshot per (page, locale)
    expect(unique).toContain('published_page_pageId_locale_key');

    // indexes along the ownership chain and on job status
    expect(names).toContain('project_userId_idx');
    expect(names).toContain('page_projectId_idx');
    expect(names).toContain('asset_projectId_idx');
    expect(names).toContain('generation_job_projectId_status_idx');
    expect(names).toContain('generation_job_status_idx');
  });

  it('blocks duplicate (page_id, version_number) at the database level', async () => {
    const user = await prisma.user.create({ data: { email: `mig-dup-version-${Date.now()}@test.local` } });
    const project = await prisma.project.create({ data: { userId: user.id, name: 'p' } });
    const page = await prisma.page.create({ data: { projectId: project.id, title: 'page' } });

    await prisma.pageVersion.create({
      data: { pageId: page.id, versionNumber: 1, schemaVersion: '1.0.0', contentJson: { schemaVersion: '1.0.0' } },
    });
    await expect(
      prisma.pageVersion.create({
        data: { pageId: page.id, versionNumber: 1, schemaVersion: '1.0.0', contentJson: { schemaVersion: '1.0.0' } },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});