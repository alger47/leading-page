import { describe, expect, it } from 'vitest';
import { InMemoryMetrics, correlationLabels } from '../src/index.js';

describe('InMemoryMetrics counters', () => {
  it('counts by label set and mirrors the generation_jobs_total catalog', () => {
    const metrics = new InMemoryMetrics();
    const jobs = metrics.counter('generation_jobs_total');

    jobs.add({ status: 'queued' });
    jobs.add({ status: 'queued' });
    jobs.add({ status: 'completed' });

    expect(jobs.valueFor({ status: 'queued' })).toBe(2);
    expect(jobs.valueFor({ status: 'completed' })).toBe(1);
    expect(jobs.valueFor({ status: 'failed' })).toBe(0);
    expect(jobs.total()).toBe(3);
    expect(jobs.snapshot().length).toBe(2);
  });

  it('allows explicit deltas', () => {
    const metrics = new InMemoryMetrics();
    const tokens = metrics.counter('ai_tokens');

    tokens.add({ model: 'gpt-4o-mini', direction: 'in' }, 4200);
    tokens.add({ model: 'gpt-4o-mini', direction: 'in' }, 800);

    expect(tokens.valueFor({ model: 'gpt-4o-mini', direction: 'in' })).toBe(5000);
    expect(tokens.total()).toBe(5000);
  });
});

describe('InMemoryMetrics histograms', () => {
  it('summarizes observations per label set', () => {
    const metrics = new InMemoryMetrics();
    const stage = metrics.histogram('generation_stage_seconds');

    stage.observe({ stage: 'planner' }, 120);
    stage.observe({ stage: 'planner' }, 200);
    stage.observe({ stage: 'planner' }, 80);

    const summary = stage.valueFor({ stage: 'planner' });
    expect(summary.count).toBe(3);
    expect(summary.sum).toBe(400);
    expect(summary.min).toBe(80);
    expect(summary.max).toBe(200);

    const empty = stage.valueFor({ stage: 'copywriter' });
    expect(empty.count).toBe(0);
    expect(empty.sum).toBe(0);
  });

  it('keeps separate buckets per label set', () => {
    const metrics = new InMemoryMetrics();
    const stage = metrics.histogram('generation_stage_seconds');

    stage.observe({ stage: 'a' }, 100);
    stage.observe({ stage: 'b' }, 900);

    expect(stage.valueFor({ stage: 'a' }).count).toBe(1);
    expect(stage.valueFor({ stage: 'a' }).sum).toBe(100);
    expect(stage.total().count).toBe(2);
    expect(stage.total().sum).toBe(1000);
  });
});

describe('correlationLabels', () => {
  it('only emits set correlation fields as snake_case labels', () => {
    expect(
      correlationLabels({
        generationId: 'gen_1',
        stage: 'planner',
        userId: 'u_2',
        attempt: 2,
      }),
    ).toEqual({
      generation_id: 'gen_1',
      stage: 'planner',
      user_id: 'u_2',
      attempt: 2,
    });
  });

  it('returns an empty label set for an empty context', () => {
    expect(correlationLabels({})).toEqual({});
  });
});