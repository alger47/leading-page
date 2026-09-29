/**
 * Public (no auth) published-page view (Phase 10 — J5).
 *
 * The published page is served on a public host from its immutable snapshot,
 * using THE SAME deterministic renderer as previews (§5.6). It must never
 * import dashboard/editor code: the rendered HTML carries zero editor JS.
 */

import { getPrismaClient } from '@landing-ai/database';

export interface PublishedProductMeta {
  name?: string;
  price?: string;
  url?: string;
}

export interface PublishedViewByHost {
  host: string;
  versionNumber: number;
  schemaVersion: string;
  title: string;
  description?: string;
  ogImageRef?: string;
  /** Present when the page was generated from a product link (server-derived,
   * written into the envelope's page.seo.product by the engine). */
  product?: PublishedProductMeta;
  content: Record<string, unknown>;
  publishedAt: string;
}

/** Resolve a live published page by its public host (lower-cased, trimmed). */
export async function getPublishedViewByHost(host: string): Promise<PublishedViewByHost | null> {
  const normalized = host.trim().toLowerCase();
  const row = await getPrismaClient().publishedPage.findFirst({
    where: {
      unpublishedAt: null,
      subdomain: { host: normalized },
    },
    include: {
      pageVersion: true,
    },
  });
  if (!row) return null;
  const content = row.pageVersion.contentJson as Record<string, unknown>;
  const page = (content?.page ?? {}) as {
    title?: string;
    seo?: { description?: string; ogImageRef?: string; product?: PublishedProductMeta };
  };
  const seo = page.seo;
  return {
    host: normalized,
    versionNumber: row.pageVersion.versionNumber,
    schemaVersion: row.pageVersion.schemaVersion,
    title: page.title ?? `Published page`,
    description: seo?.description,
    ogImageRef: seo?.ogImageRef,
    product: seo?.product,
    content,
    publishedAt: row.publishedAt.toISOString(),
  };
}