/**
 * Phase 16 part 2 — tolerant product-page extraction. Fixture HTML mimics the
 * well-known AliExpress script state (`window.runParams`) plus standard OG
 * meta tags; the extractor must survive malformed JSON, dedupe images, and
 * absolutize protocol-relative URLs. Never throws.
 */

import { describe, expect, it } from 'vitest';
import { EMPTY_PRODUCT, absolutizeImageUrl, extractProduct, suggestBrief } from '../lib/product-extract';

const RUNPARAMS_FIXTURE = `
<!doctype html><html><head><script>
window.runParams = {"data":{"root":{"fields":{
  "titleModule":{"subject":"Wireless Earbuds Pro with ANC"},
  "priceModule":{"formatedActivityPrice":"US $12,99","discountRatio":10},
  "featureList":[{"text":"Battery life up to 30 hours"},{"text":"Bluetooth 5.4"},{"name":"tag","text":"Active noise cancelling"}],
  "imagePathList":["//ae01.alicdn.com/kf/Sabc123.webp","//ae01.alicdn.com/kf/Sdef456.jpg","//ae01.alicdn.com/kf/Sabc123.webp"]}
}}};
</script></head></html>`;

const BROKEN_JSON_FIXTURE = `
<!doctype html><html><head>
<script>window.runParams = {"data":{"root":{"fields":{"titleModule":{"subject":"Survives the broken scan"},"priceModule":{,,,}}}}</script>
<meta property="og:title" content="OG Fallback Title">
<meta property="og:image" content="https://ae01.alicdn.com/og-banner.jpg">
</head></html>`;

const EMPTY_FIXTURE = '<!doctype html><html><head></head><body><p>nothing here</p></body></html>';

describe('extractProduct', () => {
  it('extracts title, price, bullets and images from runParams JSON', () => {
    const product = extractProduct(RUNPARAMS_FIXTURE, 'https://www.aliexpress.com');
    expect(product.title).toBe('Wireless Earbuds Pro with ANC');
    expect(product.price).toBe('US $12,99');
    expect(product.bullets).toEqual(expect.arrayContaining(['Battery life up to 30 hours', 'Bluetooth 5.4', 'Active noise cancelling']));
    // Deduped + absolutized protocol-relative URLs.
    expect(product.images).toEqual([
      'https://ae01.alicdn.com/kf/Sabc123.webp',
      'https://ae01.alicdn.com/kf/Sdef456.jpg',
    ]);
  });

  it('falls back to regex/OG layers when the JSON scan fails', () => {
    const product = extractProduct(BROKEN_JSON_FIXTURE, 'https://www.aliexpress.com');
    expect(product.title).toBe('Survives the broken scan');
    expect(product.images).toEqual(['https://ae01.alicdn.com/og-banner.jpg']);
  });

  it('never throws on garbage and returns EMPTY_PRODUCT shape', () => {
    const product = extractProduct(EMPTY_FIXTURE, 'https://www.aliexpress.com');
    expect(product.title).toBeNull();
    expect(product.price).toBeNull();
    expect(product.bullets).toEqual([]);
    expect(product.images).toEqual([]);
    expect(extractProduct('', 'https://x.test')).toEqual(EMPTY_PRODUCT);
  });
});

describe('absolutizeImageUrl', () => {
  it('keeps absolute and protocol-relative URLs, rejects bare paths', () => {
    expect(absolutizeImageUrl('https://a.test/i.webp')).toBe('https://a.test/i.webp');
    expect(absolutizeImageUrl('//a.test/i.webp')).toBe('https://a.test/i.webp');
    expect(absolutizeImageUrl('')).toBe('');
  });
});

describe('suggestBrief', () => {
  it('builds a bounded, deterministic brief from the product fields', () => {
    const brief = suggestBrief({
      title: 'Wireless Earbuds Pro',
      price: 'US $12,99',
      bullets: ['Battery life up to 30 hours', 'Bluetooth 5.4'],
    });
    expect(brief).toContain('Product: Wireless Earbuds Pro');
    expect(brief).toContain('Price: US $12,99');
    expect(brief).toContain('- Battery life up to 30 hours');
    expect(brief.length).toBeLessThanOrEqual(4000);
  });
});