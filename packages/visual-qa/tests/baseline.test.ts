/**
 * Phase 12 — baseline management unit tests (pure, no Chrome).
 *
 * Covers the snapshot/diff contract used by `pnpm qa` and CI: verdict
 * regressions, stale corpora (new/removed pages), and a matching run.
 */

import { describe, it, expect } from 'vitest';

import { buildBaseline, diffAgainstBaseline, type BaselinePage } from '../src/baseline.js';

const green: BaselinePage[] = [
  { name: 'ai-saas-en-001', passed: true, passedChecks: 7, totalChecks: 7 },
  { name: 'ai-vet-ar-001', passed: true, passedChecks: 7, totalChecks: 7 },
  { name: 'valid-saas-en-001', passed: true, passedChecks: 7, totalChecks: 7 },
  { name: 'valid-vet-ar-001', passed: true, passedChecks: 7, totalChecks: 7 },
];

describe('visual-qa baseline snapshots', () => {
  it('builds a stable, schema-versioned snapshot', () => {
    const snap = buildBaseline(green, '2026-09-17T00:00:00.000Z');
    expect(snap).toEqual({
      schema: 'fixtures-visual-baseline/1',
      generatedAt: '2026-09-17T00:00:00.000Z',
      pages: green,
    });
  });

  it('matches when the corpus verdicts are unchanged', () => {
    const diff = diffAgainstBaseline(green, buildBaseline(green));
    expect(diff).toMatchObject({ ok: true, regressions: [], missingInBaseline: [], removedFromCorpus: [] });
  });

  it('flags a regression when a previously-green page now fails', () => {
    const now = green.map((p) => (p.name === 'valid-saas-en-001' ? { ...p, passed: false, passedChecks: 2 } : p));
    const diff = diffAgainstBaseline(now, buildBaseline(green));
    expect(diff.ok).toBe(false);
    expect(diff.regressions).toEqual([
      { name: 'valid-saas-en-001', baselinePassed: true, nowPassed: false },
    ]);
    expect(diff.missingInBaseline).toEqual([]);
    expect(diff.removedFromCorpus).toEqual([]);
  });

  it('does not flag a page that stays failed (no new regression)', () => {
    const base: BaselinePage[] = [{ name: 'broken-en-001', passed: false, passedChecks: 1, totalChecks: 7 }];
    expect(diffAgainstBaseline(base, buildBaseline(base)).ok).toBe(true);
  });

  it('flags a stale baseline when current run adds pages', () => {
    const now = [...green, { name: 'ai-bistro-ar-001', passed: true, passedChecks: 7, totalChecks: 7 }];
    const diff = diffAgainstBaseline(now, buildBaseline(green));
    expect(diff.ok).toBe(false);
    expect(diff.missingInBaseline).toEqual(['ai-bistro-ar-001']);
  });

  it('flags a stale baseline when the corpus dropped a page', () => {
    const now = green.slice(0, 3);
    const diff = diffAgainstBaseline(now, buildBaseline(green));
    expect(diff.ok).toBe(false);
    expect(diff.removedFromCorpus).toEqual(['valid-vet-ar-001']);
  });
});