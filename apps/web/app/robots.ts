/**
 * robots.txt — public indexability baseline (SEO gate).
 *
 * Root is crawlable (the dashboard shell is noindex via metadata, published
 * pages are index/follow). Private/editor paths are already blocked by auth;
 * hiding them here would leak nothing and would only slow crawls.
 *
 * force-dynamic: the Sitemap URL embeds the public base URL, which is only
 * known at runtime (Render env) — a build-time prerender bakes localhost.
 */

import type { MetadataRoute } from 'next';
import { publicBaseUrl } from '@/lib/published-seo';

export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
    },
    sitemap: `${publicBaseUrl()}/sitemap.xml`,
  };
}