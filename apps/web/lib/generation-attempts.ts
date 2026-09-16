/**
 * Maps the engine's per-attempt ledger output (JobResult.to_dict() →
 * ledger.attempts_detail in apps/ai-engine/app/contracts.py) into the database
 * GenerationAttempt rows (GAP-2). Pure + defensive: rows whose shape cannot be
 * mapped are skipped, never thrown; the outcome translation is total for the
 * engine Outcome enum; writing is idempotent by contract (JobsRepository
 * recordAttempt upserts per (jobId, stage, attempt)).
 */

import type { RecordAttemptInput } from '@landing-ai/database';

type AttemptOutcome = RecordAttemptInput['outcome'];

const OUTCOME_MAP: Record<string, AttemptOutcome> = {
  ok: 'SUCCESS',
  malformed: 'FAILED',
  refused: 'FAILED',
  timeout: 'TIMED_OUT',
  provider_error: 'FAILED',
};

interface EngineAttemptLike {
  stage?: unknown;
  attempt?: unknown;
  prompt?: unknown;
  provider?: unknown;
  model?: unknown;
  tokens_in?: unknown;
  tokens_out?: unknown;
  cost_usd?: unknown;
  latency_ms?: unknown;
  outcome?: unknown;
  issues?: unknown;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function mapEngineAttemptsToDb(attemptsDetail: readonly unknown[] | undefined): RecordAttemptInput[] {
  if (!Array.isArray(attemptsDetail)) return [];

  const rows: RecordAttemptInput[] = [];
  for (const raw of attemptsDetail) {
    if (typeof raw !== 'object' || raw === null) continue;
    const attempt = raw as EngineAttemptLike;
    if (typeof attempt.stage !== 'string' || attempt.stage.length === 0) continue;
    const attemptNumber = toFiniteNumber(attempt.attempt);
    if (attemptNumber === null) continue;
    const outcome = OUTCOME_MAP[String(attempt.outcome)];
    if (outcome === undefined) continue;

    const provider = typeof attempt.provider === 'string' ? attempt.provider : undefined;
    const model = typeof attempt.model === 'string' ? attempt.model : undefined;
    const promptVersion = typeof attempt.prompt === 'string' ? attempt.prompt : undefined;
    const tokensIn = toFiniteNumber(attempt.tokens_in);
    const tokensOut = toFiniteNumber(attempt.tokens_out);
    const costUsd = toFiniteNumber(attempt.cost_usd);
    const latencyMs = toFiniteNumber(attempt.latency_ms);

    rows.push({
      stage: attempt.stage,
      attempt: attemptNumber,
      ...(provider !== undefined && provider.length > 0 ? { provider } : {}),
      ...(model !== undefined && model.length > 0 ? { model } : {}),
      ...(promptVersion !== undefined && promptVersion.length > 0 ? { promptVersion } : {}),
      ...(tokensIn !== null ? { tokensIn } : {}),
      ...(tokensOut !== null ? { tokensOut } : {}),
      ...(costUsd !== null ? { costUsd } : {}),
      ...(latencyMs !== null ? { latencyMs } : {}),
      outcome,
      ...(Array.isArray(attempt.issues)
        ? { validationJson: attempt.issues as RecordAttemptInput['validationJson'] }
        : {}),
    });
  }
  return rows;
}