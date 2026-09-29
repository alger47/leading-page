/**
 * sitemap.xml (SEO gate — public indexability).
 *
 * Live published pages only (unpublishedAt NULL with an owned subdomain host):
 * soft-unpublished snapshots and draft hosts never appear. lastmod is the
 * publish timestamp. Deterministic ordering keeps the sitemap stable between
 * regenerations.
 */

import { getPrismaClient } from '@landing-ai/database';
import type { MetadataRoute } from 'next';
import { publicBaseUrl } from '@/lib/published-seo';

// DB-backed → never prerender at build time (no DATABASE_URL/unreachable DB
// during next build must not kill the deploy); resolve per request.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const rows = await getPrismaClient().publishedPage.findMany({
    where: {
      unpublishedAt: null,
      subdomain: { isNot: null },
    },
    select: {
      subdomain: { select: { host: true } },
      publishedAt: true,
    },
    orderBy: { publishedAt: 'asc' },
  });

  const base = `${publicBaseUrl()}/`;
  return rows
    .filter((row): row is (typeof rows)[number] & { subdomain: { host: string } } => Boolean(row.subdomain?.host))
    .map((row) => ({
      url: `${base}${row.subdomain.host}`,
      lastModified: row.publishedAt,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    }));
}