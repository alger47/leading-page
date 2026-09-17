/**
 * Asset presentation layer: `asset:` logical refs must never reach an <img src>
 * (CSP `img-src 'self'` blocks them). Tests the S3-aware resolver and the
 * deterministic placeholder builder.
 */
import { describe, expect, it } from 'vitest';
import { buildPlaceholderSvg, resolveAssetUrl } from '../lib/assets.js';

describe('resolveAssetUrl', () => {
  it('maps asset: refs to the self-hosted placeholder path', () => {
    expect(resolveAssetUrl('asset:hero-saas')).toBe('/assets/asset/asset%3Ahero-saas');
    expect(resolveAssetUrl('asset:gallery-restaurant-1')).toBe('/assets/asset/asset%3Agallery-restaurant-1');
  });

  it('prefers the S3-compatible base when configured', () => {
    const prev = process.env.NEXT_PUBLIC_ASSET_S3_BASE_URL;
    process.env.NEXT_PUBLIC_ASSET_S3_BASE_URL = 'https://cdn.example.com/';
    try {
      expect(resolveAssetUrl('asset:hero-saas')).toBe('https://cdn.example.com/asset%3Ahero-saas');
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_ASSET_S3_BASE_URL;
      else process.env.NEXT_PUBLIC_ASSET_S3_BASE_URL = prev;
    }
  });

  it('leaves non-asset urls untouched', () => {
    expect(resolveAssetUrl('https://cdn.example.com/hero.jpg')).toBe('https://cdn.example.com/hero.jpg');
    expect(resolveAssetUrl('/assets/stock/office.svg')).toBe('/assets/stock/office.svg');
  });
});

describe('buildPlaceholderSvg', () => {
  it('is deterministic and labels the ref', () => {
    const a = buildPlaceholderSvg('asset:gallery-restaurant-1');
    const b = buildPlaceholderSvg('asset:gallery-restaurant-1');
    expect(a).toBe(b);
    expect(a).toContain('Gallery Restaurant 1');
    expect(a).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(a.startsWith('<svg')).toBe(true);
  });

  it('escapes markup so a hostile ref cannot break out of the SVG text node (Phase 14)', () => {
    const svg = buildPlaceholderSvg('asset:hero<script>alert(1)</script>&"x');
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('&amp;');
    expect(svg).toContain('&quot;');
    expect(svg).not.toMatch(/<text[^>]*>[^<]*<script/);
  });
});