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
  /** Server-derived product metadata (product-link generation). Present when
   * the page was generated from a product URL; enables Product structured
   * data + `og:type=product` markup. */
  product?: { name?: string; price?: string; url?: string };
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

/** Next Metadata for a live page: canonical + description + indexable + OG.
 * The Product signal lives in `publishedProductJsonLd` structured data: Next
 * 14.2's OpenGraph serializer runs a `switch` over a fixed og:type union and
 * throws on unknown values, so `og:type=product` is deliberately NOT set here
 * (the type stays `website`, the OG default) — honest minima over markup that
 * the platform would crash trying to emit. */
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

// Display-string → ISO currency for the Offer node. Only well-known tokens are
// honored; an unrecognized price string emits no offer rather than a wrong one
// (honest minima — Product without offers is still valid structured data).
const CURRENCY_TOKENS: Array<[RegExp, string]> = [
  [/us\s?\$/i, 'USD'],
  [/EUR/i, 'EUR'],
  [/AED/i, 'AED'],
  [/SAR/i, 'SAR'],
  [/EGP/i, 'EGP'],
  [/DZD/i, 'DZD'],
  [/MAD/i, 'MAD'],
  [/TND/i, 'TND'],
  [/JPY/i, 'JPY'],
  [/GBP/i, 'GBP'],
  [/KWD/i, 'KWD'],
];

/** schema.org Offer from a display price string, or undefined when no known
 * currency token can be pinned (never guesses a currency). */
export function offerForPrice(
  price: string,
): { '@type': 'Offer'; price: string; priceCurrency: string; availability: string } | undefined {
  const matched = CURRENCY_TOKENS.find(([re]) => re.test(price));
  if (!matched) return undefined;
  return {
    '@type': 'Offer',
    price: price.trim(),
    priceCurrency: matched[1],
    availability: 'https://schema.org/InStock',
  };
}

/**
 * schema.org Product node for a product-linked published page. Emitted only
 * when the snapshot carries server-derived product metadata; `name`/`image`
 * come from the page, the price offer only when its currency is pinned.
 */
export function publishedProductJsonLd(view: PublishedSeoView): Record<string, unknown> | null {
  if (!view.product) return null;
  const url = publishedPageUrl(view.host);
  const ogImage = view.ogImageRef ? publishedOgImageUrl(view.ogImageRef) : undefined;
  const node: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: view.product.name ?? view.title,
    url,
    ...(ogImage ? { image: ogImage } : {}),
  };
  if (view.product.price) {
    const offer = offerForPrice(view.product.price);
    if (offer) node.offers = { ...offer, url };
  }
  return node;
}