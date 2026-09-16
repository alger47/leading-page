import { describe, expect, it } from 'vitest';
import { mapEngineAttemptsToDb } from '../lib/generation-attempts';

describe('mapEngineAttemptsToDb', () => {
  it('maps a well-formed engine attempt into a GenerationAttempt row', () => {
    const rows = mapEngineAttemptsToDb([
      {
        stage: 'content-generator',
        attempt: 1,
        prompt: 'stage4-content-generator@v6',
        model_class: 'groq-llama-3.1-8b',
        provider: 'groq',
        model: 'llama-3.1-8b-instant',
        tokens_in: 1200,
        tokens_out: 300,
        cost_usd: 0.000012,
        latency_ms: 2450.3,
        outcome: 'ok',
        issues: [],
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      stage: 'content-generator',
      attempt: 1,
      promptVersion: 'stage4-content-generator@v6',
      provider: 'groq',
      model: 'llama-3.1-8b-instant',
      tokensIn: 1200,
      tokensOut: 300,
      costUsd: 0.000012,
      latencyMs: 2450.3,
      outcome: 'SUCCESS',
      validationJson: [],
    });
  });

  it('translates the engine Outcome enum to the DB AttemptOutcome enum', () => {
    const rows = mapEngineAttemptsToDb([
      { stage: 'planner', attempt: 1, outcome: 'ok' },
      { stage: 'planner', attempt: 2, outcome: 'malformed' },
      { stage: 'planner', attempt: 3, outcome: 'refused' },
      { stage: 'planner', attempt: 4, outcome: 'timeout' },
      { stage: 'planner', attempt: 5, outcome: 'provider_error' },
    ]);
    expect(rows.map((r) => r.outcome)).toEqual(['SUCCESS', 'FAILED', 'FAILED', 'TIMED_OUT', 'FAILED']);
  });

  it('skips rows that cannot be mapped instead of throwing', () => {
    const rows = mapEngineAttemptsToDb([
      null,
      'garbage',
      { attempt: 1, outcome: 'ok' }, // no stage
      { stage: 's', outcome: 'ok' }, // no attempt
      { stage: 's', attempt: 1 }, // no/invalid outcome
      { stage: 's', attempt: 2, outcome: 'mystery' }, // unknown outcome
    ]);
    expect(rows).toHaveLength(0);
  });

  it('tolerates strings for numeric fields', () => {
    const rows = mapEngineAttemptsToDb([
      { stage: 's', attempt: 1, outcome: 'ok', tokens_in: '42', cost_usd: '0.001', latency_ms: '3.5' },
    ]);
    expect(rows[0].tokensIn).toBe(42);
    expect(rows[0].costUsd).toBe(0.001);
    expect(rows[0].latencyMs).toBe(3.5);
  });

  it('returns an empty array for a missing or non-array ledger', () => {
    expect(mapEngineAttemptsToDb(undefined)).toEqual([]);
    expect(mapEngineAttemptsToDb({} as unknown[])).toEqual([]);
  });
});