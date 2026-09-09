/**
 * Development-only seed (PD-05 / §10.3): never shipped to production, no fake
 * production data. Creates one demo tenant, a vet project with published
 * placeholder page + real golden brief jobs, and registers the committed
 * engine prompt assets in the PromptVersion registry.
 *
 * Idempotent: safe to run repeatedly (`pnpm seed`).
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPrismaClient } from '../src/client.js';
import { ProjectsRepository } from '../src/repositories/projects.js';
import { PagesRepository } from '../src/repositories/pages.js';
import { JobsRepository } from '../src/repositories/jobs.js';
import { PublishingRepository } from '../src/repositories/published.js';
import { PromptVersionsRepository } from '../src/repositories/prompts.js';
import type { Owner } from '../src/owner.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const promptsDir = path.join(repoRoot, 'apps', 'ai-engine', 'app', 'prompts');

const PROMPT_STAGES = ['brief-analyzer', 'page-planner', 'layout-planner', 'content-generator', 'asset-planner'];

async function main(): Promise<void> {
  const prisma = getPrismaClient();
  const projects = new ProjectsRepository(prisma);
  const pages = new PagesRepository(prisma);
  const jobs = new JobsRepository(prisma);
  const publishing = new PublishingRepository(prisma);
  const prompts = new PromptVersionsRepository(prisma);

  const owner: Owner = { userId: 'demo-owner' };
  let user = await prisma.user.findUnique({ where: { email: 'demoatelier@example.local' } });
  if (!user) {
    user = await prisma.user.create({
      data: { email: 'demoatelier@example.local', name: 'Demo Atelier' },
    });
  }
  owner.userId = user.id;

  // --- vet project (ar) -----------------------------------------------
  const vetExample = JSON.parse(
    readFileSync(path.join(repoRoot, 'packages', 'page-schema', 'examples', 'valid-vet-ar-001.json'), 'utf8'),
  );
  let vetProject = await projects.list(owner).then((rows) => rows.find((p) => p.name === 'Le Coq Vétérinaire'));
  if (!vetProject) vetProject = await projects.create(owner, { name: 'Le Coq Vétérinaire', defaultLocale: 'ar', tone: 'warm-professional' });

  let vetPage = await pages.list(owner, vetProject.id).then((rows) => rows[0]);
  if (!vetPage) vetPage = await pages.create(owner, vetProject.id, { title: 'عيادة الأصدقاء البيطرية', locale: 'ar' });
  const existingVersions = await pages.listVersions(owner, vetProject.id, vetPage.id);
  if (existingVersions.length === 0) {
    await pages.saveVersion(owner, vetProject.id, vetPage.id, {
      baseVersion: 0,
      schemaVersion: vetExample.schemaVersion,
      content: vetExample,
    });
  }

  let subdomain = await publishing.attachSubdomain(owner, vetProject.id, 'vet-demo.landing-ai.test').catch(() => undefined);
  const alreadyPublished = await publishing.getForPage(owner, vetProject.id, vetPage.id);
  if (!alreadyPublished) {
    await publishing.publish(owner, vetProject.id, vetPage.id, { versionNumber: 1, subdomainId: subdomain?.id });
  }

  const vetBrief = readFileSync(
    path.join(repoRoot, 'apps', 'ai-engine', 'evaluation', 'golden', 'vet-ar-001.json'),
    'utf8',
  );
  const vetJob = JSON.parse(vetBrief);
  const hasVetJob = await jobs.get(owner, vetProject.id, 'gen_seed_vet_001').then((j) => true).catch(() => false);
  if (!hasVetJob) {
    await jobs.create(owner, vetProject.id, {
    id: 'gen_seed_vet_001',
    label: 'عيادة الأصدقاء البيطرية — golden vet-ar-001',
    brief: vetJob.brief,
    locale: 'ar',
    tone: 'warm-professional',
    requestJson: { brief: vetJob.brief, locale: 'ar', tone: 'warm-professional' },
    idempotencyKey: 'seed-vet-ar-001',
    fingerprint: 'seed-vet-ar-001',
    traceId: 'seed-trace-vet',
  });
    const vet = await jobs.get(owner, vetProject.id, 'gen_seed_vet_001');
    await jobs.transition(owner, vetProject.id, vet.id, {
      from: 'QUEUED',
      to: 'RUNNING',
      fields: { engineJobId: 'seed-engine-vet', startedAt: new Date() },
      event: { type: 'job.started', at: new Date().toISOString() },
    });
    await jobs.transition(owner, vetProject.id, vet.id, {
      from: 'RUNNING',
      to: 'COMPLETED',
      fields: { resultJson: { page: {}, locale: 'ar' }, completedAt: new Date() },
      event: { type: 'job.completed', at: new Date().toISOString() },
    });
    await jobs.recordAttempt(owner, vetProject.id, vet.id, {
      stage: 'content-generator',
      attempt: 1,
      provider: 'stub',
      model: 'stub-engine',
      outcome: 'SUCCESS',
    });
  }

  // --- SaaS project (en) with a queued job -----------------------------
  let saasProject = await projects.list(owner).then((rows) => rows.find((p) => p.name === 'NovaCloud'));
  if (!saasProject) saasProject = await projects.create(owner, { name: 'NovaCloud', defaultLocale: 'en', tone: 'bold-minimal' });
  const hasSaasJob = await jobs.get(owner, saasProject.id, 'gen_seed_saas_001').then((j) => true).catch(() => false);
  if (!hasSaasJob) {
    await jobs.create(owner, saasProject.id, {
        id: 'gen_seed_saas_001',
        label: 'NovaCloud — queued demo generation',
        brief: 'A developer-tools SaaS. Describe pricing and integrations.',
        locale: 'en',
        tone: 'bold-minimal',
        requestJson: { brief: 'A developer-tools SaaS. Describe pricing and integrations.', locale: 'en', tone: 'bold-minimal' },
        idempotencyKey: 'seed-saas-001',
        fingerprint: 'seed-saas-001',
        traceId: 'seed-trace-saas',
      });
    }

  // --- PromptVersion registry from committed prompt assets ------------
  for (const [index, stage] of PROMPT_STAGES.entries()) {
    const file = path.join(promptsDir, `stage${index + 1}-${stage}.yaml`);
    const content = readFileSync(file);
    await prompts.register({
      stage,
      name: `stage${index + 1}-${stage}`,
      version: 1,
      contentHash: createHash('sha256').update(content).digest('hex'),
      contentRef: path.relative(repoRoot, file),
    });
  }

  await prisma.$disconnect();
  console.log('[seed] dev database seeded: 1 demo user, 2 projects, prompt registry, golden-brief jobs.');
}

main().catch((error) => {
  console.error('[seed] failed:', error);
  process.exitCode = 1;
});