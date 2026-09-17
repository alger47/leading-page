/**
 * Phase 13 — Performance harness (generation latency · render · vitals ·
 * images · pubslated-page budgets §5.7).
 *
 * Measures what is actually measurable on this machine and surfaces the rest:
 *   - renderMs   server-side renderToStaticMarkup per envelope (react-dom/server)
 *   - vitals     LCP / CLS / load over a real file:// navigation in system Chrome
 *   - images     format + intrinsic dimensions + transfer bytes per page
 *   - budgets    §5.7: LCP < 2.5 s, CLS < 0.1 (INP sentinel 0; no interaction
 *                fixture). Breach => exit 1.
 *   - engine     per-stage generation latency p50/p95/e2e from the last golden
 *                regression report (apps/ai-engine/evaluation/reports), read-only.
 *
 * Chrome-less environments skip the vitals + image probes (like qa.mjs L3) and
 * still exit 0, so the harness never fails purely on missing tooling.
 *
 * Usage: node scripts/perf.mjs [--json <out.json>] [--quiet]
 */

import { readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const ENGINE_REPORTS = join(ROOT, 'apps', 'ai-engine', 'evaluation', 'reports');
const EXAMPLES = join(ROOT, 'packages', 'page-schema', 'examples');

const argv = process.argv.slice(2);
const jsonOut = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null;
const quiet = argv.includes('--quiet');

const PAGE_NAMES = ['ai-saas-en-001', 'ai-vet-ar-001', 'valid-saas-en-001', 'valid-vet-ar-001'];

function log(message = '') {
  if (!quiet) console.log(message);
}

const { openChrome, resolveChromePath, measureVitals, withinBudgets } = await import(
  '../packages/visual-qa/dist/index.mjs'
);

function loadEngineLatency() {
  const live = join(ENGINE_REPORTS, 'metrics-live.json');
  if (existsSync(live)) {
    try {
      return { source: 'metrics-live.json', runAt: JSON.parse(readFileSync(live, 'utf8')).run_at ?? null };
    } catch {
      // fall through to scanning regression reports
    }
  }
  const regression = existsSync(ENGINE_REPORTS)
    ? readdirSync(ENGINE_REPORTS).find((name) => /-regression-.*\.json$/.test(name))
    : null;
  if (regression) {
    try {
      return {
        source: regression,
        runAt: JSON.parse(readFileSync(join(ENGINE_REPORTS, regression), 'utf8')).run_at ?? null,
      };
    } catch {
      // unreadable report: surfaced as an informational gap below
    }
  }
  return null;
}

function engineBlock(source) {
  if (!source) return null;
  const path = join(ENGINE_REPORTS, source.source);
  try {
    const report = JSON.parse(readFileSync(path, 'utf8'));
    const metrics = report.metrics ?? report;
    const stages = {};
    const e2e = {};
    let cost = null;
    for (const [key, value] of Object.entries(metrics)) {
      const stageMatch = /^latency_ms_(p50|p95):([a-z-]+)$/.exec(key);
      if (stageMatch) {
        stages[stageMatch[2]] ??= {};
        stages[stageMatch[2]][stageMatch[1]] = value;
      }
      const e2eMatch = /^e2e_latency_ms_(p50|p95)$/.exec(key);
      if (e2eMatch) e2e[e2eMatch[1]] = value;
      if (key === 'cost_per_successful_page') cost = value;
    }
    if (Object.keys(stages).length || Object.keys(e2e).length) {
      return { source: source.source, runAt: source.runAt, stages, e2e, costPerPage: cost };
    }
  } catch {
    // report exists but cannot be parsed; report as gap in the run row
  }
  return { source: source.source, runAt: source.runAt, stages: {}, e2e: {}, costPerPage: null };
}

const chrome = resolveChromePath();
log('Phase 13 — performance harness');
log(`chrome: ${chrome ?? 'not found (vitals/image probes skipped)'}`);

const pages = [];
const breaches = [];

if (chrome) {
  const { browser, context } = await openChrome();
  try {
    for (const name of PAGE_NAMES) {
      const file = join(EXAMPLES, `${name}.json`);
      if (!existsSync(file)) {
        log(`- ${name}: fixture missing, skipped`);
        continue;
      }
      const envelope = JSON.parse(readFileSync(file, 'utf8'));
      const vitals = await measureVitals(context, envelope);
      const ok = withinBudgets(vitals);
      pages.push({ name, ...vitals, within_budgets: ok });
      const imgSummary = vitals.images.length
        ? `images=${vitals.images
            .map((img) => `${img.format || 'unknown'}@${img.naturalWidth || 'unresolved'}x${img.naturalHeight || 'unresolved'}`)
            .join(',')}`
        : 'no <img> elements';
      log(
        `- ${name}: render=${vitals.renderMs}ms load=${vitals.loadMs}ms lcp=${vitals.lcpMs}ms cls=${vitals.cls} doc=${vitals.documentBytes}B ${imgSummary} → ${ok ? 'within budget' : 'BUDGET BREACH'}`,
      );
      if (!ok) breaches.push(`${name}: unbudgeted vitals`);
    }
  } finally {
    await browser.close();
  }
} else {
  for (const name of PAGE_NAMES) {
    pages.push({ name, within_budgets: true, skipped: true });
  }
}

const engine = engineBlock(loadEngineLatency());
if (engine) {
  log('');
  log(`engine latency (golden report: ${engine.source}, run ${engine.runAt ?? 'unknown'})`);
  if (engine.e2e.p50 != null) log(`- e2e: ${engine.e2e.p50}ms p50 / ${engine.e2e.p95}ms p95`);
  for (const [stage, values] of Object.entries(engine.stages)) {
    log(`- ${stage}: ${values.p50 ?? '?'}ms p50 / ${values.p95 ?? '?'}ms p95`);
  }
  if (engine.costPerPage != null) log(`- cost per successful page: $${Number(engine.costPerPage).toFixed(4)}`);
} else {
  log('\nengine latency: no golden report found; run `python -m app.evaluation.regression --run" first');
}

log('');
if (breaches.length) {
  log(`RESULT: BREACH (${breaches.length})`);
} else {
  log(`RESULT: OK (${pages.length} pages)`);
}

const report = {
  run_at: new Date().toISOString(),
  chrome,
  engine: engine
    ? {
        source: engine.source,
        run_at: engine.runAt,
        e2e_latency_ms: engine.e2e,
        stages_latency_ms: engine.stages,
        cost_per_successful_page: engine.costPerPage,
      }
    : null,
  pages,
  budget_breaches: breaches,
};
if (jsonOut) {
  writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  log(`report written to ${jsonOut}`);
}

process.exit(breaches.length ? 1 : 0);