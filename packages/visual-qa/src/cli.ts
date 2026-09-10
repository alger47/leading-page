#!/usr/bin/env node
/**
 * visual-qa CLI (Phase 12).
 *
 *   visual-qa [file...] [--chrome <path>] [--out <report.json>] [--screenshot dir] [--quiet] [--headful]
 *
 * Without files, audits the shipped example corpus (2 real AI pages + 2 seed
 * pages across page-schema/examples). Exit codes:
 *   0 all pages pass; 1 any VIS check failed; 2 Chrome/browser unavailable; 3 envelope invalid.
 */

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { resolveChromePath, CHROME_MISSING_HINT } from './chrome.js';
import { auditEnvelope, openChrome, VisualQaError } from './index.js';
import { summarize } from './report.js';

const EXAMPLES = ['ai-saas-en-001.json', 'ai-vet-ar-001.json', 'valid-saas-en-001.json', 'valid-vet-ar-001.json'];
const EXAMPLES_DIR = fileURLToPath(new URL('../../page-schema/examples/', import.meta.url));

function parseArgs(argv: string[]): { files: string[]; chrome?: string; out?: string; screenshotDir?: string; quiet: boolean; headful: boolean } {
  const files: string[] = [];
  let chrome: string | undefined;
  let out: string | undefined;
  let screenshotDir: string | undefined;
  let quiet = false;
  let headful = false;
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
  return { files, chrome, out, screenshotDir, quiet, headful };
}

function loadEnvelope(file: string): { name: string; envelope: Record<string, unknown> } {
  const raw = readFileSync(file, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`not a JSON object: ${file}`);
  }
  return { name: file, envelope: parsed as Record<string, unknown> };
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

    if (!args.quiet) console.log(`\n${inputs.length} page(s) — ${totalPassed} check(s) passed, ${totalFailed} failed → ${ok ? 'ALL GREEN' : 'GATE BLOCKED'}`);
    return ok ? 0 : 1;
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