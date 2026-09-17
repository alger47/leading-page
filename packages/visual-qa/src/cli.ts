#!/usr/bin/env node
/**
 * visual-qa CLI (Phase 12).
 *
 *   visual-qa [file...] [--chrome <path>] [--out <report.json>] [--screenshot dir] [--quiet] [--headful]
 *              [--baseline <file>] [--update-baseline <file>]
 *
 * Without files, audits the shipped example corpus (2 real AI pages + 2 seed
 * pages across page-schema/examples). Exit codes:
 *   0 all pages pass; 1 any VIS check failed or the run regressed vs the
 *     baseline; 2 Chrome/browser unavailable; 3 envelope invalid; 4 baseline
 *     missing or stale (re-run deliberately with --update-baseline).
 */

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveChromePath, CHROME_MISSING_HINT } from './chrome.js';
import { auditEnvelope, openChrome, VisualQaError } from './index.js';
import { buildBaseline, diffAgainstBaseline } from './baseline.js';
import { summarize } from './report.js';

const EXAMPLES = ['ai-saas-en-001.json', 'ai-vet-ar-001.json', 'valid-saas-en-001.json', 'valid-vet-ar-001.json'];
const EXAMPLES_DIR = fileURLToPath(new URL('../../page-schema/examples/', import.meta.url));

function parseArgs(argv: string[]): {
  files: string[];
  chrome?: string;
  out?: string;
  screenshotDir?: string;
  quiet: boolean;
  headful: boolean;
  baseline?: string;
  updateBaseline?: string;
} {
  const files: string[] = [];
  let chrome: string | undefined;
  let out: string | undefined;
  let screenshotDir: string | undefined;
  let quiet = false;
  let headful = false;
  let baseline: string | undefined;
  let updateBaseline: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--chrome':
        chrome = argv[++i];
        break;
      case '--out':
        out = argv[++i];
        break;
      case '--screenshot':
        screenshotDir = argv[++i];
        break;
      case '--baseline':
        baseline = argv[++i];
        break;
      case '--update-baseline':
        updateBaseline = argv[++i];
        break;
      case '--quiet':
        quiet = true;
        break;
      case '--headful':
        headful = true;
        break;
      default:
        if (argv[i].startsWith('--')) throw new Error(`unknown flag ${argv[i]}`);
        files.push(argv[i]);
    }
  }
  return { files, chrome, out, screenshotDir, quiet, headful, baseline, updateBaseline };
}

function loadEnvelope(file: string): { name: string; envelope: Record<string, unknown> } {
  const raw = readFileSync(file, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`not a JSON object: ${file}`);
  }
  return { name: basename(file).replace(/\.json$/, ''), envelope: parsed as Record<string, unknown> };
}

async function main(): Promise<number> {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`visual-qa: ${(err as Error).message}`);
    return 3;
  }

  const files = args.files.length ? args.files : EXAMPLES.map((f) => `${EXAMPLES_DIR}${f}`);
  const inputs: Array<{ name: string; envelope: Record<string, unknown> }> = [];
  for (const file of files) {
    try {
      inputs.push(loadEnvelope(file));
    } catch (err) {
      console.error(`visual-qa: ${(err as Error).message}`);
      return 3;
    }
  }

  const executable = resolveChromePath(args.chrome);
  if (!executable) {
    console.error(`visual-qa: ${CHROME_MISSING_HINT}`);
    return 2;
  }

  let browser;
  try {
    const opened = await openChrome({ chromePath: executable, headless: !args.headful });
    browser = opened.browser;
    const { context } = opened;

    if (args.screenshotDir) mkdirSync(args.screenshotDir, { recursive: true });

    const reports = [];
    let totalPassed = 0;
    let totalFailed = 0;
    let ok = true;
    for (const input of inputs) {
      const { report } = await auditEnvelope(context, input.envelope);
      const counts = summarize(report.checks);
      totalPassed += counts.passed;
      totalFailed += counts.failed;
      const pageOk = report.passed;
      ok &&= pageOk;

      if (!args.quiet) {
        console.log(`\n${input.name} — ${pageOk ? 'PASS' : 'FAIL'} (${counts.passed}/${counts.failed})`);
        for (const check of report.checks) {
          const marker = check.status === 'pass' ? '  ✓' : '  ✗';
          console.log(`${marker} ${check.id} ${check.title}`);
          for (const detail of check.details) console.log(`      · ${detail}`);
        }
      }
      reports.push({ page: input.name, ...report });
      if (args.screenshotDir && !pageOk) {
        const page = await context.newPage();
        const { buildDocument } = await import('./html.js');
        await page.setContent(buildDocument(input.envelope), { waitUntil: 'domcontentloaded', timeout: 15_000 });
        const slug = input.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'page';
        const shot = `${args.screenshotDir}/${slug}.png`;
        await page.screenshot({ path: shot, fullPage: true });
        console.log(`  screenshot → ${shot}`);
        await page.close();
      }
    }

    if (args.out) {
      writeFileSync(
        args.out,
        JSON.stringify(
          {
            executable,
            generatedAt: new Date().toISOString(),
            pages: reports,
            totals: { passed: totalPassed, failed: totalFailed },
          },
          null,
          2,
        ),
      );
      if (!args.quiet) console.log(`report → ${args.out}`);
    }

    const baselinePages = reports.map((r) => ({
      name: r.page,
      passed: r.passed,
      passedChecks: summarize(r.checks).passed,
      totalChecks: r.checks.length,
    }));

    if (args.updateBaseline) {
      writeFileSync(args.updateBaseline, JSON.stringify(buildBaseline(baselinePages), null, 2));
      if (!args.quiet) console.log(`baseline → ${args.updateBaseline} (${baselinePages.length} page(s))`);
    }

    let baselineMatched = true;
    let baselineStale = false;
    if (args.baseline) {
      let snapshot;
      try {
        snapshot = JSON.parse(readFileSync(args.baseline, 'utf8')) as ReturnType<typeof buildBaseline>;
      } catch (err) {
        console.error(`visual-qa: baseline ${args.baseline} missing or unreadable: ${(err as Error).message}`);
        return 4;
      }
      const diff = diffAgainstBaseline(baselinePages, snapshot);
      if (!args.quiet) {
        console.log(`baseline → ${args.baseline}: ${diff.regressions.length} regression(s), ${diff.missingInBaseline.length} new, ${diff.removedFromCorpus.length} removed`);
        for (const r of diff.regressions) console.log(`  ✗ ${r.name}: baseline PASS → now FAIL`);
        for (const name of diff.missingInBaseline) console.log(`  ? ${name}: not in baseline`);
        for (const name of diff.removedFromCorpus) console.log(`  − ${name}: in baseline, not in corpus`);
      }
      if (diff.missingInBaseline.length > 0 || diff.removedFromCorpus.length > 0) {
        baselineStale = true;
      }
      baselineMatched = diff.regressions.length === 0;
    }

    if (!args.quiet) console.log(`\n${inputs.length} page(s) — ${totalPassed} check(s) passed, ${totalFailed} failed → ${ok ? 'ALL GREEN' : 'GATE BLOCKED'}`);

    if (baselineStale) {
      console.error(`visual-qa: baseline is stale — re-run deliberately with --update-baseline ${args.baseline ?? ''}`);
      return 4;
    }
    if (!ok || !baselineMatched) return 1;
    return 0;
  } catch (err) {
    if (err instanceof VisualQaError) {
      console.error(`visual-qa: ${err.message}`);
      return 2;
    }
    console.error(`visual-qa: ${(err as Error).message}`);
    return 2;
  } finally {
    await browser?.close();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(`visual-qa: ${(err as Error).message}`);
    process.exitCode = 2;
  });