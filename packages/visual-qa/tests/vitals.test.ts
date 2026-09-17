/**
 * Phase 13 — vitals probe tests (published-page budgets, §5.7).
 *
 * Measures LCP/CLS/load on the shipped example envelopes the same way the L3
 * Chrome suite does. Skipped cleanly when Chrome/Edge is unavailable. The HEAD
 * is numeric sanity (a fixture harness has no network, so absolute millisecond
 * floors are tiny); the budget boundary itself is asserted in perf/scripts.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { resolveChromePath } from '../src/index.js';
import { chromium, type Browser } from 'playwright-core';

import type { EnvelopeView } from '../src/checks.js';

import aiSaasEn from '../../page-schema/examples/ai-saas-en-001.json';
import aiVetAr from '../../page-schema/examples/ai-vet-ar-001.json';
import validSaasEn from '../../page-schema/examples/valid-saas-en-001.json';
import validVetAr from '../../page-schema/examples/valid-vet-ar-001.json';

import { measureVitals, withinBudgets, buildDocument, renderPageMarkup } from '../src/index.js';

const chromePath = resolveChromePath();

const describeChrome = chromePath ? describe : describe.skip;

describeChrome('Published-page vitals (headless Chrome)', () => {
  const corpus: Array<{ name: string; envelope: EnvelopeView }> = [
    { name: 'ai-saas-en-001', envelope: aiSaasEn as unknown as EnvelopeView },
    { name: 'ai-vet-ar-001', envelope: aiVetAr as unknown as EnvelopeView },
    { name: 'valid-saas-en-001', envelope: validSaasEn as unknown as EnvelopeView },
    { name: 'valid-vet-ar-001', envelope: validVetAr as unknown as EnvelopeView },
  ];
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({
      executablePath: chromePath ?? undefined,
      headless: true,
      args: ['--disable-gpu', '--no-first-run'],
    });
  });

  afterAll(async () => {
    await browser?.close();
  });

  for (const fixture of corpus) {
    it(`${fixture.name} reports measurable, in-budget vitals`, async () => {
      const vitals = await measureVitals(browser, fixture.envelope);
      expect(vitals.renderMs).toBeGreaterThan(0);
      expect(vitals.loadMs).toBeGreaterThan(0);
      expect(typeof vitals.lcpMs).toBe('number');
      expect(vitals.lcpMs).toBeGreaterThan(0);
      expect(typeof vitals.cls).toBe('number');
      expect(vitals.cls).toBeGreaterThanOrEqual(-1);
      expect(withinBudgets(vitals)).toBe(true);
      expect(vitals.documentBytes).toBeGreaterThan(0);
    });
  }

  it('lcp budget boundary rejects an unrealistic 0ms claim', () => {
    expect(withinBudgets({ lcpMs: 0, cls: 0 })).toBe(false);
  });

  it('buildDocument emits a full document with the same renderer as preview', () => {
    const html = buildDocument(validSaasEn as unknown as Record<string, unknown>);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain(renderPageMarkup(validSaasEn as unknown as Record<string, unknown>));
    expect(html).toContain('<html lang="en"');
  });
});