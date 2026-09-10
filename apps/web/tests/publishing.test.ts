/**
 * Publishing unit tests (Phase 10 — J5): host derivation, URL joining, and the
 * shared server-side render of a published snapshot (deterministic, same
 * renderer as previews, zero dashboard/editor JS in the markup itself).
 */

import { describe, expect, it } from 'vitest';
import { deriveHostForPage, publishedUrl } from '../lib/publishing';
import { renderPublishedHtml } from './render-html.js';
import { publishableEnvelope } from './harness.js';
import { config } from '../lib/env';

describe('publish host derivation', () => {
  it('derives a stable host once per page under the configured suffix', () => {
    const first = deriveHostForPage('cm1234567890abcdefghijkl');
    expect(deriveHostForPage('cm1234567890abcdefghijkl')).toBe(first);
    expect(first.endsWith(`.${config.publicHostSuffix}`)).toBe(true);
    expect(first).toMatch(/^p-[a-z0-9]+\./);
  });

  it('joins the public base URL with the host for the live URL', () => {
    expect(publishedUrl('p-abc.localhost')).toBe(`${config.publicBaseUrl}/p-abc.localhost`);
  });
});

describe('published snapshot rendering', () => {
  it('server-renders the snapshot through the same renderer, without editor JS', () => {
    const html = renderPublishedHtml(publishableEnvelope());
    expect(html).toContain('Soins vétérinaires de confiance');
    expect(html).toMatch(/<h1[^>]*>/);
    expect(html).toContain('Cabinet Vetrilleux');
    expect(html).not.toMatch(/Editor|Logout|Publish|Versions|Brief/);
  });

  it('never crashes on an unknown section type (E-RENDER-001 safe fallback)', () => {
    const doc = publishableEnvelope();
    (doc.sections as Array<Record<string, unknown>>).push({
      id: 'mystery-1',
      type: 'not-a-section',
      variant: 'x',
      content: {},
    });
    const html = renderPublishedHtml(doc);
    expect(html).toContain('Unsupported section type');
  });
});