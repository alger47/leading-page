/**
 * robots.txt — public indexability baseline (SEO gate).
 *
 * Root is crawlable (the dashboard shell is noindex via metadata, published
 * pages are index/follow). Private/editor paths are already blocked by auth;
 * hiding them here would leak nothing and would only slow crawls.
 */

import type { MetadataRoute } from 'next';
import { publicBaseUrl } from '@/lib/published-seo';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
    },
    sitemap: `${publicBaseUrl()}/sitemap.xml`,
  };
}