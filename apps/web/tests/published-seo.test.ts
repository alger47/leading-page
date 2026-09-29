/**
 * SEO gate unit tests (published pages): canonical, description, robots,
 * openGraph og:image and JSON-LD builders must stay DB-free and deterministic.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  publishedPageJsonLd,
  publishedPageMetadata,
  publishedOgImageUrl,
  publishedPageUrl,
} from '../lib/published-seo.js';

const view = {
  host: 'p-acb123def.landing-ai.test',
  title: 'Ghardaia Boutique',
  description: 'Handcrafted rugs, direct from the M\'zab valley.',
  ogImageRef: 'asset:og',
};

beforeEach(() => {
  process.env.PUBLIC_BASE_URL = 'https://dar.example';
  process.env.PUBLIC_HOST_SUFFIX = 'landing-ai.test';
});

describe('publishedPageUrl', () => {
  it('joins the base URL and host without slop', () => {
    expect(publishedPageUrl('p-abc.landing-ai.test')).toBe('https://dar.example/p-abc.landing-ai.test');
  });
});

describe('publishedOgImageUrl', () => {
  it('resolves an asset ref to an absolute self-hosted URL', () => {
    expect(publishedOgImageUrl('asset:og')).toBe('https://dar.example/assets/asset/asset%3Aog');
  });

  it('uses the S3 base when configured', () => {
    const prev = process.env.NEXT_PUBLIC_ASSET_S3_BASE_URL;
    process.env.NEXT_PUBLIC_ASSET_S3_BASE_URL = 'https://cdn.example.com';
    try {
      expect(publishedOgImageUrl('asset:og')).toBe('https://cdn.example.com/asset%3Aog');
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_ASSET_S3_BASE_URL;
      else process.env.NEXT_PUBLIC_ASSET_S3_BASE_URL = prev;
    }
  });

  it('passes absolute URLs through untouched', () => {
    expect(publishedOgImageUrl('https://cdn.example.com/og.jpg')).toBe('https://cdn.example.com/og.jpg');
  });
});

describe('publishedPageMetadata', () => {
  it('emits canonical + description + robots + og image', () => {
    const meta = publishedPageMetadata(view);
    expect(meta.alternates?.canonical).toBe('https://dar.example/p-acb123def.landing-ai.test');
    expect(meta.description).toBe(view.description);
    expect(meta.robots).toEqual({ index: true, follow: true });
    expect(meta.openGraph?.url).toBe('https://dar.example/p-acb123def.landing-ai.test');
    expect(meta.openGraph?.images).toEqual([
      { url: 'https://dar.example/assets/asset/asset%3Aog', width: 1024, height: 1024, alt: view.title },
    ]);
    expect(meta.openGraph?.type).toBe('website');
  });

  it('omits og images and description when absent', () => {
    const meta = publishedPageMetadata({ host: view.host, title: 'T' });
    expect(meta.description).toBeUndefined();
    expect(meta.openGraph?.images).toBeUndefined();
    expect(meta.alternates?.canonical).toBeTruthy();
  });
});

describe('publishedPageJsonLd', () => {
  it('emits a schema.org WebPage with url/name/description/image', () => {
    const ld = publishedPageJsonLd(view);
    expect(ld['@type']).toBe('WebPage');
    expect(ld.url).toBe('https://dar.example/p-acb123def.landing-ai.test');
    expect(ld.name).toBe(view.title);
    expect(ld.description).toBe(view.description);
    expect(ld.primaryImageOfPage).toBe('https://dar.example/assets/asset/asset%3Aog');
  });

  it('omits optional description/image when absent', () => {
    const ld = publishedPageJsonLd({ host: view.host, title: 'T' });
    expect(ld.description).toBeUndefined();
    expect(ld.primaryImageOfPage).toBeUndefined();
  });
});