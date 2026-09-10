import type { PrismaClient, PublishedPage, PublicationEvent } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { Owner } from '../owner.js';
import { requireOwnedProject } from './projects.js';
import { NotFoundError, fromPrisma } from '../errors.js';

export interface PublishOptions {
  versionNumber: number;
  subdomainId?: string | null;
  publishedBy?: string | null;
}

export interface PublishInput extends PublishOptions {
  pageId: string;
}

const PAGE_OWNERSHIP = (owner: Owner, projectId: string, pageId: string) => ({
  id: pageId,
  archivedAt: null,
  project: { id: projectId, userId: owner.userId, archivedAt: null },
});

/**
 * Publishing (§10.2): a publish moves the published_page.pageVersionId pointer
 * to the chosen immutable version; the previous snapshot stays intact because
 * page_version rows are never rewritten.
 */
export class PublishingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async publish(owner: Owner, projectId: string, pageId: string, input: PublishOptions): Promise<PublishedPage> {
    await requireOwnedProject(this.prisma, owner, projectId);

    return this.prisma.$transaction(async (tx) => {
      const page = await tx.page.findFirst({ where: PAGE_OWNERSHIP(owner, projectId, pageId) });
      if (!page) throw new NotFoundError('page', pageId, owner.userId);

      const version = await tx.pageVersion.findFirst({
        where: { pageId, versionNumber: input.versionNumber },
      });
      if (!version) throw new NotFoundError('page_version', `${pageId}#${input.versionNumber}`, owner.userId);

      if (input.subdomainId) {
        const owned = await tx.subdomain.findFirst({
          where: { id: input.subdomainId, project: { id: projectId, userId: owner.userId, archivedAt: null } },
        });
        if (!owned) throw new NotFoundError('subdomain', input.subdomainId, owner.userId);
      }

      const publishedPage = await tx.publishedPage.upsert({
        where: { pageId_locale: { pageId, locale: page.locale ?? 'en' } },
        create: {
          pageId,
          projectId,
          locale: page.locale ?? 'en',
          pageVersionId: version.id,
          subdomainId: input.subdomainId ?? null,
          publishedBy: input.publishedBy ?? owner.userId,
        },
        update: {
          pageVersionId: version.id,
          subdomainId: input.subdomainId ?? null,
          publishedBy: input.publishedBy ?? owner.userId,
          publishedAt: new Date(),
          unpublishedAt: null,
        },
      });

      await tx.publicationEvent.create({
        data: {
          type: 'PUBLISH',
          byUser: input.publishedBy ?? owner.userId,
          publishedPageId: publishedPage.id,
          snapshotJson: version.contentJson as Prisma.InputJsonValue,
        },
      });
      return publishedPage;
    });
  }

  /** Idempotent downgrade-to-draft: marks unpublished, keeps audit trail (§10.4). */
  async unpublish(owner: Owner, projectId: string, pageId: string, byUser?: string | null): Promise<PublishedPage> {
    return this.prisma.$transaction(async (tx) => {
      const publishedPage = await tx.publishedPage.findFirst({
        where: { pageId, project: { id: projectId, userId: owner.userId, archivedAt: null } },
      });
      if (!publishedPage) throw new NotFoundError('published_page', pageId, owner.userId);

      await tx.publicationEvent.create({
        data: { type: 'UNPUBLISH', byUser: byUser ?? owner.userId, publishedPageId: publishedPage.id },
      });
      return tx.publishedPage.update({
        where: { id: publishedPage.id },
        data: { unpublishedAt: new Date() },
      });
    });
  }

  async getForPage(owner: Owner, projectId: string, pageId: string): Promise<PublishedPage | null> {
    await requireOwnedProject(this.prisma, owner, projectId);
    return this.prisma.publishedPage.findFirst({ where: { pageId, projectId } });
  }

  /**
   * Current published state with its live subdomain host and version number —
   * used by the dashboard view and the publish service to keep the host stable
   * across republishes.
   */
  async getForPageWithSubdomain(
    owner: Owner,
    projectId: string,
    pageId: string,
  ): Promise<{ host: string | null; versionNumber: number; publishedAt: Date; unpublishedAt: Date | null } | null> {
    await requireOwnedProject(this.prisma, owner, projectId);
    const row = await this.prisma.publishedPage.findFirst({
      where: { pageId, projectId },
      include: {
        subdomain: { select: { host: true } },
        pageVersion: { select: { versionNumber: true } },
      },
    });
    if (!row) return null;
    return {
      host: row.subdomain?.host ?? null,
      versionNumber: row.pageVersion.versionNumber,
      publishedAt: row.publishedAt,
      unpublishedAt: row.unpublishedAt,
    };
  }

  async events(owner: Owner, projectId: string, pageId: string): Promise<PublicationEvent[]> {
    await requireOwnedProject(this.prisma, owner, projectId);
    return this.prisma.publicationEvent.findMany({
      where: { publishedPage: { pageId, projectId } },
      orderBy: { at: 'desc' },
    });
  }

  async attachSubdomain(owner: Owner, projectId: string, host: string): Promise<{ id: string; host: string }> {
    await requireOwnedProject(this.prisma, owner, projectId);
    try {
      return await this.prisma.subdomain.create({ data: { host, projectId } });
    } catch (error) {
      throw fromPrisma(error, { entity: 'subdomain', field: 'host', value: host });
    }
  }
}