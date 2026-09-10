/**
 * Visual QA publish gate (Phase 12).
 *
 * Opt-in (ENABLE_VISUAL_QA_GATE=1): after the L1/L2 gate accepts a version, the
 * version's envelope is rendered with the production Renderer in headless
 * system Chrome (via @landing-ai/visual-qa) and must pass VIS-001..007 before
 * the snapshot goes live. Failures map to 422 E-PUBLISH-002 (never a silent
 * publish of a visually broken page).
 *
 * The gate is deliberately non-blocking by default: a deployment without a
 * Chrome install simply skips it, because "no sampler available" is not a
 * rendition verdict. The visual-qa CLI (gate command) is the CI/publish-gate
 * path when operators DO want hard enforcement.
 */

import { ApiError } from '@/lib/api';

export interface VisualGateIssue {
  checkId: string;
  title: string;
  details: string[];
}

export class VisualPublishGateError extends ApiError {
  constructor(issues: VisualGateIssue[]) {
    super('the version failed the visual QA gate (VIS-001..007)', 422, 'E-PUBLISH-002', { issues });
    this.name = 'VisualPublishGateError';
  }
}

export function visualPublishGateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.ENABLE_VISUAL_QA_GATE;
  return value === '1' || value === 'true';
}

/**
 * Runs the visual gate when enabled; returns the (possibly skipped) gate
 * outcome. Any sampling/infra failure degrades to "skipped" so production
 * without Chrome is unaffected. A genuine visual failure throws
 * VisualPublishGateError.
 */
export async function runVisualGateIfEnabled(
  content: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ skipped: boolean; reason?: string }> {
  if (!visualPublishGateEnabled(env)) return { skipped: true, reason: 'gate disabled (ENABLE_VISUAL_QA_GATE)' };
  try {
    const { runVisualPublishGate, gatePasses } = await import(/* webpackIgnore: true */ '@landing-ai/visual-qa');
    const outcome = await runVisualPublishGate(content, {}, env);
    if (outcome.skipped) return { skipped: true, reason: outcome.reason };
    if (!gatePasses(outcome.report)) {
      const issues = (outcome.report?.checks ?? [])
        .filter((c) => c.status === 'fail')
        .map((c) => ({ checkId: c.id, title: c.title, details: c.details }));
      throw new VisualPublishGateError(issues);
    }
    return { skipped: false };
  } catch (error) {
    if (error instanceof VisualPublishGateError) throw error;
    return { skipped: true, reason: (error as Error).message };
  }
}