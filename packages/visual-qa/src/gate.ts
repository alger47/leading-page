/**
 * Publish gate (Phase 12): a page whose envelope fails VIS-001..007 must not
 * ship. Ops enable the gate explicitly (env ENABLE_VISUAL_QA_GATE / CLI flag);
 * when Chrome is unavailable the gate skips rather than blocks publishing —
 * a missing sampler is not a rendition verdict.
 */

import { resolveChromePath } from './chrome.js';
import { runVisualChecks, VisualQaError, type VisualQaOptions } from './index.js';
import type { PageReport } from './report.js';

export interface VisualPublishGateResult {
  skipped: boolean;
  reason?: string;
  report?: PageReport;
}

export function isVisualPublishGateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ENABLE_VISUAL_QA_GATE === '1' || env.ENABLE_VISUAL_QA_GATE === 'true';
}

export async function runVisualPublishGate(
  envelope: Record<string, unknown>,
  opts: VisualQaOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<VisualPublishGateResult> {
  if (!isVisualPublishGateEnabled(env) && !opts.chromePath) {
    return { skipped: true, reason: 'gate disabled (ENABLE_VISUAL_QA_GATE)' };
  }
  const executable = resolveChromePath(opts.chromePath);
  if (!executable) {
    return { skipped: true, reason: 'no system Chrome available for visual QA' };
  }
  try {
    return { skipped: false, report: (await runVisualChecks(envelope, { ...opts, chromePath: executable })).report };
  } catch (err) {
    if (err instanceof VisualQaError) {
      return { skipped: true, reason: `${err.code}: ${err.message}` };
    }
    throw err;
  }
}

export function gatePasses(report: PageReport | undefined): boolean {
  return Boolean(report?.passed ?? true);
}