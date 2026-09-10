/**
 * Server data services: tenant-scoped views over the DB repositories for
 * server components and API routes. No business logic beyond shaping —
 * authorization lives in the repositories, which always receive an Owner.
 */

import {
  getPrismaClient,
  JobsRepository,
  PagesRepository,
  ProjectsRepository,
  PublishingRepository,
  type Owner,
} from '@landing-ai/database';
import { config } from './env';

function repos() {
  const prisma = getPrismaClient();
  return {
    projects: new ProjectsRepository(prisma),
    pages: new PagesRepository(prisma),
    jobs: new JobsRepository(prisma),
  };
}

export interface ProjectView {
  id: string;
  name: string;
  defaultLocale: string | null;
  tone: string | null;
  pageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PageView {
  id: string;
  title: string;
  locale: string | null;
  status: string;
  versionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PageDetailView {
  page: PageView;
  latestVersion: { versionNumber: number; schemaVersion: string; content: unknown } | null;
  latestJob: {
    id: string;
    status: string;
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: string;
  } | null;
}

export async function listProjectsView(owner: Owner): Promise<ProjectView[]> {
  const { projects, pages } = repos();
  const rows = await projects.list(owner);
  return Promise.all(
    rows.map(async (p) => {
      const pageRows = await pages.list(owner, p.id);
      return {
        id: p.id,
        name: p.name,
        defaultLocale: p.defaultLocale,
        tone: p.tone,
        pageCount: pageRows.length,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      };
    }),
  );
}

export async function createProjectView(owner: Owner, input: { name: string; defaultLocale?: string | null; tone?: string | null }): Promise<ProjectView> {
  const { projects } = repos();
  const p = await projects.create(owner, input);
  return {
    id: p.id,
    name: p.name,
    defaultLocale: p.defaultLocale,
    tone: p.tone,
    pageCount: 0,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function getProjectView(owner: Owner, projectId: string): Promise<{ id: string; name: string; defaultLocale: string | null; tone: string | null; createdAt: string }> {
  const { projects } = repos();
  const p = await projects.get(owner, projectId);
  return { id: p.id, name: p.name, defaultLocale: p.defaultLocale, tone: p.tone, createdAt: p.createdAt.toISOString() };
}

export async function listPagesView(owner: Owner, projectId: string): Promise<PageView[]> {
  const { pages } = repos();
  const rows = await pages.list(owner, projectId);
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      title: row.title,
      locale: row.locale,
      status: row.status,
      versionCount: (await pages.listVersions(owner, projectId, row.id)).length,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
  );
}

export async function createPageView(owner: Owner, projectId: string, input: { title: string; locale?: string | null }): Promise<PageView> {
  const { pages } = repos();
  const row = await pages.create(owner, projectId, input);
  return {
    id: row.id,
    title: row.title,
    locale: row.locale,
    status: row.status,
    versionCount: 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface PublishView {
  published: { host: string; url: string; versionNumber: number; publishedAt: string } | null;
  versions: number[];
  latestVersion: number | null;
}

export async function getPublishView(owner: Owner, projectId: string, pageId: string): Promise<PublishView> {
  const { pages } = repos();
  const versions = await pages.listVersions(owner, projectId, pageId);
  const publishing = new PublishingRepository(getPrismaClient());
  const live = await publishing.getForPageWithSubdomain(owner, projectId, pageId);

  let published: PublishView['published'] = null;
  if (live && live.unpublishedAt === null && live.host) {
    published = {
      host: live.host,
      url: `${config.publicBaseUrl}/${live.host}`,
      versionNumber: live.versionNumber,
      publishedAt: live.publishedAt.toISOString(),
    };
  }
  return {
    published,
    versions: versions.map((v) => v.versionNumber),
    latestVersion: versions[versions.length - 1]?.versionNumber ?? null,
  };
}

export async function getPageDetailView(owner: Owner, projectId: string, pageId: string): Promise<PageDetailView> {
  const { pages, jobs } = repos();
  const page = await pages.get(owner, projectId, pageId);
  const versions = await pages.listVersions(owner, projectId, pageId);
  const latest = versions[versions.length - 1] ?? null;
  const pageJobs = await jobs.listByPage(owner, projectId, pageId);
  const latestJob = pageJobs[0] ?? null;
  return {
    page: {
      id: page.id,
      title: page.title,
      locale: page.locale,
      status: page.status,
      versionCount: versions.length,
      createdAt: page.createdAt.toISOString(),
      updatedAt: page.updatedAt.toISOString(),
    },
    latestVersion: latest
      ? { versionNumber: latest.versionNumber, schemaVersion: latest.schemaVersion, content: latest.contentJson }
      : null,
    latestJob: latestJob
      ? {
          id: latestJob.id,
          status: latestJob.status,
          errorCode: latestJob.errorCode,
          errorMessage: latestJob.errorMessage,
          createdAt: latestJob.createdAt.toISOString(),
        }
      : null,
  };
}