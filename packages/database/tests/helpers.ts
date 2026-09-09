import type { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../src/client.js';
import { ProjectsRepository } from '../src/repositories/projects.js';
import { PagesRepository } from '../src/repositories/pages.js';
import { JobsRepository } from '../src/repositories/jobs.js';
import { AssetsRepository } from '../src/repositories/assets.js';
import { PublishingRepository } from '../src/repositories/published.js';
import { PromptVersionsRepository } from '../src/repositories/prompts.js';
import type { Owner } from '../src/owner.js';

export const prisma: PrismaClient = getPrismaClient();

export interface Repos {
  projects: ProjectsRepository;
  pages: PagesRepository;
  jobs: JobsRepository;
  assets: AssetsRepository;
  publishing: PublishingRepository;
  prompts: PromptVersionsRepository;
}

export function makeRepos(client: PrismaClient = prisma): Repos {
  return {
    projects: new ProjectsRepository(client),
    pages: new PagesRepository(client),
    jobs: new JobsRepository(client),
    assets: new AssetsRepository(client),
    publishing: new PublishingRepository(client),
    prompts: new PromptVersionsRepository(client),
  };
}

export interface Tenant {
  owner: Owner;
  userId: string;
  projectId: string;
  pageId: string;
  jobId: string;
  assetId: string;
}

let seq = 0;

/** Valid Page Schema envelope (structural subset of the canonical schema). */
export function makeEnvelope(title: string): Record<string, unknown> {
  return {
    schemaVersion: '1.0.0',
    page: { title, locale: 'ar', direction: 'rtl' },
    theme: {
      preset: 'warm-professional',
      font: 'rubik',
      primaryColor: 'role:primary',
      radius: 'medium',
      density: 'comfortable',
    },
    sections: [
      {
        id: 'hero-1',
        type: 'hero',
        variant: 'split',
        content: {
          title,
          subtitle: 'subtitle',
          primaryCta: { label: 'l', href: '#x' },
        },
        layoutHint: { mediaSide: 'end' },
      },
    ],
    assets: [],
  };
}

export function invalidEnvelope(): unknown {
  return { schemaVersion: '1.0.0', page: { title: 'x' }, theme: {}, sections: [] };
}

/** Full tenant fixture: user → project → page → version(#1) → job → asset. */
export async function makeTenant(client: PrismaClient = prisma): Promise<Tenant> {
  const tag = `t${Date.now()}-${seq++}`;
  const user = await client.user.create({
    data: { email: `u-${tag}@test.local`, name: `tenant ${tag}` },
  });
  const owner: Owner = { userId: user.id };
  const repos = makeRepos(client);

  const project = await repos.projects.create(owner, { name: `Project ${tag}`, defaultLocale: 'ar' });
  const page = await repos.pages.create(owner, project.id, { title: `Page ${tag}`, locale: 'ar' });
  await repos.pages.saveVersion(owner, project.id, page.id, {
    baseVersion: 0,
    schemaVersion: '1.0.0',
    content: makeEnvelope(`v1 ${tag}`),
  });
  const job = await repos.jobs.create(owner, project.id, {
    id: `gen_${tag}`,
    label: `Job ${tag}`,
    brief: `brief ${tag}`,
    locale: 'ar',
    requestJson: { brief: `brief ${tag}`, locale: 'ar' },
    idempotencyKey: `key-${tag}`,
    fingerprint: `fp-${tag}`,
    traceId: `trace-${tag}`,
  });
  const asset = await repos.assets.create(owner, project.id, {
    kind: 'IMAGE',
    storageRef: `asset-${tag}`,
    mimeType: 'image/webp',
  });

  return { owner, userId: user.id, projectId: project.id, pageId: page.id, jobId: job.id, assetId: asset.id };
}

/** Truncate every table between tests so each test starts from a clean slate. */
export async function resetDb(client: PrismaClient = prisma): Promise<void> {
  await client.$executeRawUnsafe(
    `TRUNCATE TABLE publication_event, published_page, subdomain, generation_attempt, generation_job,
     asset, page_version, page, project, "user", prompt_version RESTART IDENTITY CASCADE`,
  );
}