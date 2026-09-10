/**
 * Report shapes and status rolls (Phase 12 — visual-qa).
 */

import type { CheckResult, EnvelopeView } from './checks.js';

export interface PageReport {
  envelope: EnvelopeView;
  checks: CheckResult[];
  passed: boolean;
}

export function summarize(checks: CheckResult[]): { passed: number; failed: number } {
  const passed = checks.filter((c) => c.status === 'pass').length;
  return { passed, failed: checks.length - passed };
}