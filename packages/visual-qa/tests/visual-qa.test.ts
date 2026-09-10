/**
 * Phase 12 — visual-qa package tests.
 *
 * Drives REAL headless Chrome (playwright-core + system install) over the four
 * shipped example envelopes. Skipped cleanly when Chrome/Edge is unavailable so
 * Chrome-less environments still get a green (tiny) suite.
 */

import { describe, it, expect } from 'vitest';

import { runVisualChecks, resolveChromePath, summarize, VisualQaError } from '../src/index.js';
import type { EnvelopeView } from '../src/checks.js';

import aiSaasEn from '../../page-schema/examples/ai-saas-en-001.json';
import aiVetAr from '../../page-schema/examples/ai-vet-ar-001.json';
import validSaasEn from '../../page-schema/examples/valid-saas-en-001.json';
import validVetAr from '../../page-schema/examples/valid-vet-ar-001.json';

const chromePath = resolveChromePath();

const describeChrome = chromePath ? describe : describe.skip;

describeChrome('visual-qa corpus (headless Chrome)', () => {
  it('has a usable system Chrome for the run', () => {
    expect(chromePath).toBeTruthy();
  });

  const corpus: Array<{ name: string; envelope: EnvelopeView }> = [
    { name: 'ai-saas-en-001', envelope: aiSaasEn as unknown as EnvelopeView },
    { name: 'ai-vet-ar-001', envelope: aiVetAr as unknown as EnvelopeView },
    { name: 'valid-saas-en-001', envelope: validSaasEn as unknown as EnvelopeView },
    { name: 'valid-vet-ar-001', envelope: validVetAr as unknown as EnvelopeView },
  ];

  for (const fixture of corpus) {
    it(`${fixture.name} passes all VIS-001..007 checks`, async () => {
      const { report } = await runVisualChecks(fixture.envelope, { chromePath: chromePath ?? undefined });
      const failed = report.checks.filter((c) => c.status === 'fail');
      expect(failed, failed.map((c) => `${c.id}: ${c.details.join('; ')}`).join('\n')).toEqual([]);
      expect(report.passed).toBe(true);
      expect(report.checks).toHaveLength(7);
    });
  }

  it('RTL page carries rtl direction end to end', async () => {
    const { report } = await runVisualChecks(aiVetAr as unknown as EnvelopeView, { chromePath: chromePath ?? undefined });
    const dirCheck = report.checks.find((c) => c.id === 'VIS-003');
    expect(dirCheck?.status).toBe('pass');
    expect(dirCheck?.details.join(' ')).toContain('rtl');
  });

  it('flags an envelope whose section type the renderer cannot handle', async () => {
    const broken: EnvelopeView = {
      page: { title: 'Broken', locale: 'en', direction: 'ltr' },
      sections: [
        { id: 'header-1', type: 'header', variant: 'basic' },
        { id: 'video-1', type: 'video', variant: 'featured' },
      ],
    };
    const { report } = await runVisualChecks(broken, { chromePath: chromePath ?? undefined });
    expect(report.passed).toBe(false);
    const vis1 = report.checks.find((c) => c.id === 'VIS-001');
    expect(vis1?.status).toBe('fail');
  });

  it('reports clean summaries for green pages', async () => {
    const { report } = await runVisualChecks(validSaasEn as unknown as EnvelopeView, {
      chromePath: chromePath ?? undefined,
    });
    expect(summarize(report.checks)).toEqual({ passed: 7, failed: 0 });
  });
});

describe('visual-qa error surface', () => {
  it('throws a typed error when no Chrome is configured', async () => {
    await expect(
      runVisualChecks(
        { page: { locale: 'en', direction: 'ltr' }, sections: [] },
        { chromePath: 'C:\\definitely\\missing\\chrome.exe' },
      ),
    ).rejects.toSatisfy((err: unknown) => err instanceof VisualQaError && (err as VisualQaError).code === 'VQA-ERR-CHROME');
  });
});