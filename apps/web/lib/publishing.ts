/**
 * Publishing service (Phase 10 — J5).
 *
 * "validate → snapshot → subdomain" (§10.2 + master catalog PHASE 10):
 *   - The L1 (structural) and L2 (semantic) gates decide what may EVER go live:
 *     nothing invalid is published (E-PUBLISH-001 on gate rejection).
 *   - The chosen immutable version is snapshotted transactionally by
 *     PublishingRepository.publish into a PublishedPage row.
 *   - A stable host is resolved per page ("username.platform.tld or configured
 *     equivalent"): an owned subdomain is reused; otherwise one is derived from
 *     the page id under the configured PUBLIC_HOST_SUFFIX.
 *
 * Unpublish is a downgrade-to-draft: the snapshot stays, the audit trail
 * stays, and the live page disappears (append-only events, §10.4).
 */

import {
  getPrismaClient,
  NotFoundError,
  PagesRepository,
  PublishingRepository,
  type Owner,
} from '@landing-ai/database';
import { validateSemantic, validateStructural } from '@landing-ai/page-schema';
import { ApiError } from '@/lib/api';
import { config } from '@/lib/env';

export class PublishGateError extends ApiError {
  constructor(issues: Array<{ layer: 'structural' | 'semantic'; ruleId: string; path: string; message: string }>) {
    super(
      'the version failed the publish gate (L1 structural or L2 semantic)',
      422,
      'E-PUBLISH-001',
      { issues },
    );
    this.name = 'PublishGateError';
  }
}

export interface PublishedView {
  host: string;
  url: string;
  versionNumber: number;
  publishedAt: string;
  locale: string;
}

/** Stable per-page host: p-<pageId tail>.<PUBLIC_HOST_SUFFIX> (dev path routing). */
export function deriveHostForPage(pageId: string): string {
  const slug = pageId.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(-12);
  return `p-${slug || 'page'}.${config.publicHostSuffix}`;
}

export function publishedUrl(host: string): string {
  return `${config.publicBaseUrl}/${host}`;
}

export interface PublishInput {
  versionNumber?: number;
  subdomainId?: string | null;
}

const toIssues = (issues: Array<{ layer: 'structural' | 'semantic'; ruleId: string; path: string; message: string }>) =>
  issues.map(({ layer, ruleId, path, message }) => ({ layer, ruleId, path, message }));

export async function publishVersion(
  owner: Owner,
  projectId: string,
  pageId: string,
  input: PublishInput,
): Promise<PublishedView> {
  const prisma = getPrismaClient();
  const pages = new PagesRepository(prisma);
  const publishing = new PublishingRepository(prisma);

  const owned = await pages.findOwnedPage(owner, pageId);
  if (!owned || owned.projectId !== projectId) throw new NotFoundError('page', pageId, owner.userId);

  const versions = await pages.listVersions(owner, owned.projectId, owned.pageId);
  const targetNumber = input.versionNumber ?? versions[versions.length - 1]?.versionNumber;
  if (typeof targetNumber !== 'number' || targetNumber < 1) {
    throw new NotFoundError('page_version', `${pageId}#${input.versionNumber ?? 'latest'}`, owner.userId);
  }

  const version = await pages.versionAt(owner, owned.projectId, owned.pageId, targetNumber);

  // Gate: L1 structural + L2 semantic both must pass. L2 warnings are fine;
  // L2 errors block publish (§8: "L2 error → block render & publish").
  const structural = validateStructural(version.contentJson);
  const semantic = validateSemantic(version.contentJson);
  if (!structural.valid || !semantic.valid) {
    throw new PublishGateError(toIssues(
      [
        ...structural.errors.map((e) => ({ layer: 'structural' as const, ruleId: e.ruleId, path: e.path, message: e.message })),
        ...semantic.errors.map((e) => ({ layer: 'semantic' as const, ruleId: e.ruleId, path: e.path, message: e.message })),
      ],
    ));
  }

  // Resolve a stable host: owned subdomain from the request, else the previous
  // host of this page (republish must not change the public URL), else derive one.
  let subdomainId = input.subdomainId ?? undefined;
  if (subdomainId === undefined) {
    const previous = await publishing.getForPageWithSubdomain(owner, owned.projectId, owned.pageId);
    if (previous?.host) {
      const ownedSub = await prisma.subdomain.findFirst({
        where: { host: previous.host, project: { id: owned.projectId, userId: owner.userId, archivedAt: null } },
      });
      if (ownedSub) subdomainId = ownedSub.id;
    }
  }
  if (subdomainId === undefined) {
    const created = await publishing.attachSubdomain(owner, owned.projectId, deriveHostForPage(owned.pageId));
    subdomainId = created.id;
  }

  const row = await publishing.publish(owner, owned.projectId, owned.pageId, {
    versionNumber: targetNumber,
    subdomainId: subdomainId ?? null,
  });

  const published: PublishedView = {
    host: deriveHostForPage(owned.pageId),
    url: publishedUrl(deriveHostForPage(owned.pageId)),
    versionNumber: targetNumber,
    publishedAt: row.publishedAt.toISOString(),
    locale: row.locale,
  };

  const live = await publishing.getForPageWithSubdomain(owner, owned.projectId, owned.pageId);
  if (live?.host) {
    published.host = live.host;
    published.url = publishedUrl(live.host);
  }
  return published;
}

/**
 * Downgrade live → draft. Idempotent: publishing nothing is already the state
 * the caller wants, so an absent PublishedPage resolves to `null` instead of 404.
 */
export async function unpublishVersion(
  owner: Owner,
  projectId: string,
  pageId: string,
): Promise<{ published: null; host: string | null }> {
  const prisma = getPrismaClient();
  const publishing = new PublishingRepository(prisma);
  const pages = new PagesRepository(prisma);
  const owned = await pages.findOwnedPage(owner, pageId);
  if (!owned || owned.projectId !== projectId) throw new NotFoundError('page', pageId, owner.userId);

  const current = await publishing.getForPageWithSubdomain(owner, owned.projectId, owned.pageId);
  try {
    await publishing.unpublish(owner, owned.projectId, owned.pageId, owner.userId);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
  return { published: null, host: current?.host ?? null };
}

export async function getPublishedView(
  owner: Owner,
  projectId: string,
  pageId: string,
): Promise<PublishedView | null> {
  const prisma = getPrismaClient();
  const publishing = new PublishingRepository(prisma);
  const pages = new PagesRepository(prisma);
  const owned = await pages.findOwnedPage(owner, pageId);
  if (!owned || owned.projectId !== projectId) throw new NotFoundError('page', pageId, owner.userId);

  const live = await publishing.getForPageWithSubdomain(owner, owned.projectId, owned.pageId);
  if (!live || live.unpublishedAt !== null || live.host === null) return null;
  return {
    host: live.host,
    url: publishedUrl(live.host),
    versionNumber: live.versionNumber,
    publishedAt: live.publishedAt.toISOString(),
    locale: '',
  };
}