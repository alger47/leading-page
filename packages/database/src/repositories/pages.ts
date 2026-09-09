import type { PrismaClient, Page, PageVersion } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { validateStructural } from '@landing-ai/page-schema';
import type { Owner } from '../owner.js';
import { requireOwnedProject } from './projects.js';
import {
  InvalidContentError,
  NotFoundError,
  OptimisticConcurrencyError,
  fromPrisma,
} from '../errors.js';

export interface PageInput {
  title: string;
  locale?: string | null;
  createdBy?: string | null;
}

export interface SaveVersionInput {
  /** Must equal the current latest version number (0 for a first draft). */
  baseVersion: number;
  schemaVersion: string;
  /** Page Schema document — L1-validated before it can be persisted (§10.2). */
  content: unknown;
  createdBy?: string | null;
}

const OWNERSHIP = (owner: Owner, projectId: string, pageId: string) => ({
  id: pageId,
  archivedAt: null,
  project: { id: projectId, userId: owner.userId, archivedAt: null },
});

export class PagesRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(owner: Owner, projectId: string, input: PageInput): Promise<Page> {
    await requireOwnedProject(this.prisma, owner, projectId);
    try {
      return await this.prisma.page.create({
        data: {
          title: input.title,
          locale: input.locale ?? null,
          createdBy: input.createdBy ?? owner.userId,
          projectId,
        },
      });
    } catch (error) {
      throw fromPrisma(error, { entity: 'page', field: 'id', value: input.title });
    }
  }

  async get(owner: Owner, projectId: string, pageId: string): Promise<Page> {
    const page = await this.prisma.page.findFirst({
      where: OWNERSHIP(owner, projectId, pageId),
    });
    if (!page) throw new NotFoundError('page', pageId, owner.userId);
    return page;
  }

  async list(owner: Owner, projectId: string): Promise<Page[]> {
    await requireOwnedProject(this.prisma, owner, projectId);
    return this.prisma.page.findMany({
      where: { projectId, archivedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async archive(owner: Owner, projectId: string, pageId: string): Promise<Page> {
    const page = await this.get(owner, projectId, pageId);
    return this.prisma.page.update({ where: { id: page.id }, data: { archivedAt: new Date() } });
  }

  // ------------------------------------------------------------ versions

  async listVersions(owner: Owner, projectId: string, pageId: string): Promise<PageVersion[]> {
    await this.get(owner, projectId, pageId);
    return this.prisma.pageVersion.findMany({
      where: { pageId },
      orderBy: { versionNumber: 'asc' },
    });
  }

  async versionAt(
    owner: Owner,
    projectId: string,
    pageId: string,
    versionNumber: number,
  ): Promise<PageVersion> {
    await this.get(owner, projectId, pageId);
    const version = await this.prisma.pageVersion.findFirst({
      where: { pageId, versionNumber },
    });
    if (!version) throw new NotFoundError('page_version', `${pageId}#${versionNumber}`, owner.userId);
    return version;
  }

  /**
   * Save a new draft version with optimistic concurrency: the insert only
   * succeeds when `baseVersion` still equals the current latest version.
   * A new version is ALWAYS a new row (§10.2) — never an in-place rewrite.
   */
  async saveVersion(owner: Owner, projectId: string, pageId: string, input: SaveVersionInput): Promise<PageVersion> {
    await this.get(owner, projectId, pageId);

    const validation = validateStructural(input.content);
    if (!validation.valid) {
      throw new InvalidContentError(validation.errors[0]?.path ?? '/', validation.errors[0]?.message ?? 'invalid schema');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const [latest] = await tx.pageVersion.findMany({
          where: { pageId },
          orderBy: { versionNumber: 'desc' },
          take: 1,
          select: { versionNumber: true },
        });
        const current = latest?.versionNumber ?? 0;
        if (input.baseVersion !== current) {
          throw new OptimisticConcurrencyError('page_version', input.baseVersion, current);
        }
        return tx.pageVersion.create({
          data: {
            pageId,
            versionNumber: current + 1,
            schemaVersion: input.schemaVersion,
            contentJson: input.content as Prisma.InputJsonValue,
            createdBy: input.createdBy ?? owner.userId,
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Race between read and insert: another txn committed the same version.
        const [latest] = await this.prisma.pageVersion.findMany({
          where: { pageId },
          orderBy: { versionNumber: 'desc' },
          take: 1,
          select: { versionNumber: true },
        });
        throw new OptimisticConcurrencyError('page_version', input.baseVersion, latest?.versionNumber ?? 0);
      }
      throw error instanceof Error ? error : fromPrisma(error, { entity: 'page_version', field: 'pageId', value: pageId });
    }
  }
}