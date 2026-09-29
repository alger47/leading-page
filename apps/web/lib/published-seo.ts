/**
 * SEO/social-share metadata for live published pages (SEO gate).
 *
 * Pure builders (no DB): given a published-page snapshot they produce the
 * canonical URL, Next Metadata (canonical/description/robots/openGraph) and the
 * JSON-LD WebPage object. Keep this module DB-free so it is trivially unit
 * tested; the published route feeds it the snapshot.
 */

import type { Metadata } from 'next';
import { resolveAssetUrl } from '@/lib/assets';

export interface PublishedSeoView {
  host: string;
  title: string;
  description?: string;
  ogImageRef?: string;
}

/** Public base URL (call-time so tests/consumers can override the env). */
export function publicBaseUrl(): string {
  // Render injects the service's own external URL at runtime; prefer the
  // explicit PUBLIC_BASE_URL, then that automatic fallback, then localhost.
  const raw =
    process.env.PUBLIC_BASE_URL ??
    process.env.RENDER_EXTERNAL_URL ??
    'http://localhost:3000';
  return raw.replace(/\/+$/, '');
}

/** Absolute public URL of a live page, e.g. "https://acme.example/p-abc123def". */
export function publishedPageUrl(host: string): string {
  return `${publicBaseUrl()}/${host}`;
}

/** Absolute URL for an `asset:` og ref (or a passthrough for absolute URLs). */
export function publishedOgImageUrl(ogImageRef: string): string {
  if (/^https?:\/\//i.test(ogImageRef)) return ogImageRef;
  const resolved = resolveAssetUrl(ogImageRef);
  if (/^https?:\/\//i.test(resolved)) return resolved;
  const base = `${publicBaseUrl()}/`;
  return resolved.startsWith('/') ? `${base.replace(/\/+$/, '')}${resolved}` : `${base}${resolved}`;
}

/** Next Metadata for a live page: canonical + description + indexable + OG. */
export function publishedPageMetadata(view: PublishedSeoView): Metadata {
  const url = publishedPageUrl(view.host);
  const ogImage = view.ogImageRef ? publishedOgImageUrl(view.ogImageRef) : undefined;
  return {
    title: view.title,
    description: view.description,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: {
      title: view.title,
      description: view.description,
      url,
      type: 'website',
      locale: 'en_US',
      images: ogImage ? [{ url: ogImage, width: 1024, height: 1024, alt: view.title }] : undefined,
    },
  };
}

/** JSON-LD structured data (schema.org WebPage) for the live page. */
export function publishedPageJsonLd(view: PublishedSeoView): Record<string, unknown> {
  const url = publishedPageUrl(view.host);
  const ogImage = view.ogImageRef ? publishedOgImageUrl(view.ogImageRef) : undefined;
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    url,
    name: view.title,
    ...(view.description ? { description: view.description } : {}),
    ...(ogImage ? { primaryImageOfPage: ogImage } : {}),
  };
}