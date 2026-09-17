/**
 * Baseline management (Phase 12): a stable, committed snapshot of the L3
 * fixture-corpus verdicts plus a strict diff used by CI / `pnpm qa`.
 *
 * The baseline is deliberately NOT auto-updated on failure: a regression
 * (page that used to pass now fails) or a stale corpus (new/removed pages)
 * makes the run exit `qa:baseline-stale` until an operator re-runs with
 * `--update-baseline`. This is the "merge is blocked if validity drops"
 * guard of master prompt §15.4.
 */

export interface BaselinePage {
  name: string;
  passed: boolean;
  passedChecks: number;
  totalChecks: number;
}

export interface BaselineSnapshot {
  schema: 'fixtures-visual-baseline/1';
  generatedAt: string;
  pages: BaselinePage[];
}

export interface BaselineDiff {
  name: string;
  baselinePassed: boolean;
  nowPassed: boolean;
}

export interface BaselineResult {
  ok: boolean;
  /** Pages whose verdict regressed vs the baseline (passed -> failed). */
  regressions: BaselineDiff[];
  /** Pages in the current run that have no entry in the baseline. */
  missingInBaseline: string[];
  /** Pages in the baseline that no longer run (removed from corpus). */
  removedFromCorpus: string[];
}

/** Stable snapshot — strips run-specific noise so diffs are verdicts only. */
export function buildBaseline(pages: BaselinePage[], generatedAt = new Date().toISOString()): BaselineSnapshot {
  return { schema: 'fixtures-visual-baseline/1', generatedAt, pages };
}

export function diffAgainstBaseline(current: BaselinePage[], snapshot: BaselineSnapshot): BaselineResult {
  const byName = new Map(snapshot.pages.map((p) => [p.name, p]));
  const regressions: BaselineDiff[] = [];
  const missingInBaseline: string[] = [];
  const currNames = new Set(current.map((p) => p.name));

  for (const page of current) {
    const base = byName.get(page.name);
    if (!base) {
      missingInBaseline.push(page.name);
      continue;
    }
    if (base.passed && !page.passed) {
      regressions.push({ name: page.name, baselinePassed: true, nowPassed: false });
    }
  }

  const removedFromCorpus = snapshot.pages.filter((p) => !currNames.has(p.name)).map((p) => p.name);
  const ok = regressions.length === 0 && missingInBaseline.length === 0 && removedFromCorpus.length === 0;
  return { ok, regressions, missingInBaseline, removedFromCorpus };
}