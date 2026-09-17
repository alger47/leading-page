#!/usr/bin/env node
/**
 * Monorepo QA gate (Phase 12).
 *
 *   node scripts/qa.mjs            # check: fail on any regression vs baseline
 *   node scripts/qa.mjs --update   # deliberate re-baseline of the corpus
 *
 * Gates, in order (each independently reportable):
 *   L1+L2  — @landing-ai/page-schema suite (every fixture stays valid/invalid)
 *            + corpus drift detection vs the baseline fixture list
 *   L3     — visual baseline (packages/visual-qa) matches the shipped corpus
 *   budget — published-page gzipped client JS stays within its baseline cap
 *
 * L3 and budget are *skipped-not-failed* when their sampler is unavailable
 * (no system Chrome, or no `next build` output yet) — the publish-gate
 * philosophy: a missing sampler is not a rendition verdict. L1+L2 always runs
 * and always blocks.
 *
 * Exit codes: 0 all green (skips allowed) · 1 any gate failed · 3 usage.
 * The visual-qa CLI reports baseline-stale as exit 4, surfaced below as a
 * `qa:stale` failure until pnpm qa:update is run deliberately.
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const EXAMPLES_DIR = join(ROOT, 'packages', 'page-schema', 'examples');
const BASELINE_PATH = join(ROOT, 'qa', 'baseline.json');
const VISUAL_BASELINE = join(ROOT, 'packages', 'visual-qa', 'baselines', 'fixtures-baseline.json');
const VISUAL_BASELINE_REL = 'packages/visual-qa/baselines/fixtures-baseline.json';
const VISUAL_CLI = join(ROOT, 'packages', 'visual-qa', 'dist', 'cli.mjs');
const BUDGET_SCRIPT = join(ROOT, 'apps', 'web', 'scripts', 'published-budget.mjs');
const WEB_DIR = join(ROOT, 'apps', 'web');

const exitCodes = { green: 0, failed: 1, usage: 3 };

function readJsonOrNull(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function runNode(target, args, opts = {}) {
  return spawnSync(process.execPath, [target, ...args], { cwd: opts.cwd ?? ROOT, encoding: 'utf8', windowsHide: true });
}

function runPnpm(args) {
  if (process.platform === 'win32') {
    return spawnSync('cmd.exe', ['/d', '/s', '/c', 'pnpm', ...args], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  }
  return spawnSync('pnpm', args, { cwd: ROOT, encoding: 'utf8' });
}

function fixtureNames() {
  return readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith('.json')).sort();
}

function corpusStale(names, baseline) {
  const recorded = [...(baseline?.fixtures ?? [])].sort();
  const changed = recorded.length !== names.length || recorded.some((n, i) => n !== names[i]);
  return { changed, added: names.filter((n) => !recorded.includes(n)), removed: recorded.filter((n) => !names.includes(n)) };
}

const L12 = {
  async check(baseline) {
    const names = fixtureNames();
    const drift = corpusStale(names, baseline);
    if (drift.changed) {
      console.error('qa: fixture corpus drifted from baseline — run `pnpm qa:update` deliberately:');
      for (const n of drift.added) console.error(`  + ${n}`);
      for (const n of drift.removed) console.error(`  - ${n}`);
      return { ok: false };
    }
    const res = runPnpm(['--filter=@landing-ai/page-schema', 'test']);
    if (res.status !== 0) {
      console.error('qa: L1/L2 fixture validation failed (@landing-ai/page-schema suite):');
      console.error((res.stdout || res.stderr || '').slice(-2000));
      return { ok: false };
    }
    console.log(`qa: L1/L2 fixtures — ${names.length} example(s), suite green`);
    return { ok: true, names };
  },

  async update() {
    const res = runPnpm(['--filter=@landing-ai/page-schema', 'test']);
    if (res.status !== 0) {
      console.error('qa: cannot re-baseline while L1/L2 are failing:');
      console.error((res.stdout || res.stderr || '').slice(-2000));
      return null;
    }
    return fixtureNames();
  },
};

function ensureVisualCli() {
  if (existsSync(VISUAL_CLI)) return true;
  const res = runPnpm(['--filter=@landing-ai/visual-qa', 'bundle']);
  if (res.status !== 0 || !existsSync(VISUAL_CLI)) {
    console.error('qa: visual-qa CLI bundle missing and could not be built:');
    console.error((res.stdout || res.stderr || '').slice(-1000));
    return false;
  }
  return true;
}

const L3 = {
  async run(baseline) {
    if (!ensureVisualCli()) return { ok: false };
    const target = baseline.visualBaseline ? join(ROOT, baseline.visualBaseline) : VISUAL_BASELINE;
    const res = runNode(VISUAL_CLI, ['--quiet', '--baseline', target]);
    if (res.status === 2 || /no system Chrome|VQA-ERR-CHROME/.test(res.stderr ?? '')) {
      console.log('qa: L3 visual baseline — SKIPPED (no system Chrome); not a regression verdict');
      return { ok: true };
    }
    if (res.status === 4) {
      console.error('qa: L3 visual baseline is stale (corpus changed) — run `pnpm qa:update` deliberately');
      return { ok: false };
    }
    if (res.status === 1) {
      console.error('qa: L3 visual regression vs baseline:');
      console.error(res.stderr ?? res.stdout ?? '');
      return { ok: false };
    }
    if (res.status !== 0) {
      console.error(`qa: L3 visual baseline — unexpected CLI exit ${res.status}`);
      return { ok: false };
    }
    console.log('qa: L3 visual baseline — match');
    return { ok: true };
  },

  async update() {
    if (!ensureVisualCli()) return false;
    const res = runNode(VISUAL_CLI, ['--quiet', '--update-baseline', VISUAL_BASELINE]);
    if (res.status === 2 || /no system Chrome|VQA-ERR-CHROME/.test(res.stderr ?? '')) {
      console.error('qa: cannot re-baseline L3 without system Chrome');
      return false;
    }
    if (res.status !== 0) {
      console.error(`qa: visual-qa CLI exited ${res.status}: ${res.stderr ?? res.stdout}`);
      return false;
    }
    console.log(`qa: L3 visual baseline updated → ${VISUAL_BASELINE}`);
    return true;
  },
};

function parseBudget(out) {
  const m = /published-page client JS \(gzipped, measured\): ([0-9.]+) KB/.exec(out ?? '');
  return m ? Math.round(parseFloat(m[1]) * 1024) : null;
}

const BUDGET = {
  async check(baseline) {
    const res = runNode(BUDGET_SCRIPT, [], { cwd: WEB_DIR });
    const bytes = parseBudget(res.stdout);
    if (!bytes) {
      console.log('qa: publish budget — SKIPPED (no next build output yet)');
      return { ok: true };
    }
    if (res.status !== 0) {
      console.error('qa: publish budget above hard cap or isolation broken:');
      console.error(res.stdout ?? res.stderr ?? '');
      return { ok: false };
    }
    const cap = baseline?.budgetBytes;
    if (cap && bytes > cap) {
      console.error(`qa: publish budget ${bytes} B > baseline cap ${cap} B — run pnpm qa:update if deliberate`);
      return { ok: false };
    }
    console.log(`qa: publish budget — ${bytes} B within baseline${cap ? ` (cap ${cap} B)` : ''}`);
    return { ok: true };
  },

  async update() {
    const res = runNode(BUDGET_SCRIPT, [], { cwd: WEB_DIR });
    const bytes = parseBudget(res.stdout);
    if (!bytes) {
      console.error('qa: cannot measure publish budget — run `pnpm build` first');
      return null;
    }
    if (res.status !== 0) {
      console.error('qa: publish budget violates the hard cap or isolation:');
      console.error(res.stdout ?? res.stderr ?? '');
      return null;
    }
    return bytes;
  },
};

function loadOrEmpty() {
  return readJsonOrNull(BASELINE_PATH) ?? { schema: 'qa-baseline/1', fixtures: [], visualBaseline: VISUAL_BASELINE_REL };
}

async function main() {
  const update = process.argv.includes('--update');
  if (update) {
    const names = await L12.update();
    if (!names) return exitCodes.failed;
    const l3ok = await L3.update();
    if (!l3ok) return exitCodes.failed;
    const budgetBytes = await BUDGET.update();
    if (budgetBytes === null) return exitCodes.failed;

    mkdirSync(dirname(BASELINE_PATH), { recursive: true });
    writeFileSync(
      BASELINE_PATH,
      JSON.stringify(
        {
          schema: 'qa-baseline/1',
          lastUpdated: new Date().toISOString(),
          fixtures: names,
          visualBaseline: VISUAL_BASELINE_REL,
          budgetBytes,
        },
        null,
        2,
      ),
    );
    console.log(`qa: baseline updated → ${BASELINE_PATH}`);
    return exitCodes.green;
  }

  const baseline = loadOrEmpty();
  const l12 = await L12.check(baseline);
  const l3 = await L3.run(baseline);
  const budget = await BUDGET.check(baseline);

  if (!l12.ok || !l3.ok || !budget.ok) return exitCodes.failed;
  console.log('qa: ALL GREEN');
  return exitCodes.green;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(`qa: ${err.message}`);
    process.exitCode = exitCodes.usage;
  });