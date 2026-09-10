/**
 * @landing-ai/visual-qa
 *
 * Public API: render a page-schema envelope with the production Renderer,
 * load it in headless system Chrome, and run the deterministic VIS-001..007
 * visual QA checks (Phase 12).
 */

import { chromium, type Browser, type BrowserContext } from 'playwright-core';

import { resolveChromePath } from './chrome.js';
import { buildDocument } from './html.js';
import { runChecks, type CheckResult, type EnvelopeView } from './checks.js';
import { PageReport, summarize } from './report.js';

export * from './checks.js';
export * from './report.js';
export { resolveChromePath, CHROME_MISSING_HINT } from './chrome.js';
export { buildDocument, renderPageMarkup } from './html.js';
export { runVisualPublishGate, gatePasses, isVisualPublishGateEnabled } from './gate.js';
export type { VisualPublishGateResult } from './gate.js';

export interface VisualQaOptions {
  /** Explicit Chrome/Edge executable; defaults to resolution of the system install. */
  chromePath?: string;
  headless?: boolean;
  viewport?: { width: number; height: number };
}

export interface VisualQaPageView {
  report: PageReport;
}

const DEFAULT_VIEWPORT = { width: 1440, height: 900 };

export class VisualQaError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'VisualQaError';
    this.code = code;
  }
}

export async function openChrome(opts: VisualQaOptions = {}): Promise<{ browser: Browser; context: BrowserContext; executable: string }> {
  const executable = resolveChromePath(opts.chromePath);
  if (!executable) {
    throw new VisualQaError('VQA-ERR-CHROME', 'No system Chrome/Edge found for visual QA.');
  }
  const browser = await chromium.launch({
    executablePath: executable,
    headless: opts.headless ?? true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
  });
  const context = await browser.newContext({
    viewport: opts.viewport ?? DEFAULT_VIEWPORT,
    colorScheme: 'light',
  });
  return { browser, context, executable };
}

export async function auditEnvelope(context: BrowserContext, envelope: EnvelopeView): Promise<VisualQaPageView> {
  if (!Array.isArray(envelope?.sections) || typeof envelope?.page !== 'object' || envelope.page === null) {
    throw new VisualQaError('VQA-ERR-ENVELOPE', 'Not a page-schema envelope (expected page + sections).');
  }
  const html = buildDocument(envelope as Record<string, unknown>);
  const page = await context.newPage();
  await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  const checks = await runChecks(page, envelope);
  await page.close();
  return { report: { envelope, checks, passed: checks.every((c) => c.status === 'pass') } };
}

/** One-shot convenience: open Chrome, audit one envelope, close. */
export async function runVisualChecks(envelope: EnvelopeView, opts: VisualQaOptions = {}): Promise<VisualQaPageView> {
  const { browser, context } = await openChrome(opts);
  try {
    return await auditEnvelope(context, envelope);
  } finally {
    await browser.close();
  }
}

export { summarize };
export type { CheckResult, PageReport };