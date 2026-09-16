/** Lightweight metrics counters + histograms (no external deps), aligned to the
 * architecture.md §12 metric catalog:
 *   generation_jobs_total{status}
 *   generation_stage_seconds{stage}
 *   ai_attempts_total{stage, outcome}
 *   ai_tokens{model, direction}
 *   ai_cost_usd{model}
 *   validation_failures_total{layer, ruleId}
 *   render_fallbacks_total{sectionType}
 * An OTLP/Prometheus exporter can be layered on top later; consumers must only
 * depend on these interfaces. */

import type { CorrelationContext } from './types.js';

/** Label values are scalar so a snapshot can be serialized / compared safely. */
export type MetricLabels = Record<string, string | number | boolean>;

export interface CounterMetric {
  name: string;
  add(labels?: MetricLabels, delta?: number): void;
  /** Current count for the exact label set. */
  valueFor(labels?: MetricLabels): number;
  /** Total count across all label sets. */
  total(): number;
  snapshot(): Array<{ labels: MetricLabels; value: number }>;
}

export interface HistogramSummary {
  count: number;
  sum: number;
  min: number;
  max: number;
  p50: number;
}

export interface HistogramMetric {
  name: string;
  observe(labels: MetricLabels, valueMs: number): void;
  valueFor(labels: MetricLabels): HistogramSummary;
  total(): HistogramSummary;
}

export interface MetricsCollector {
  counter(name: string): CounterMetric;
  histogram(name: string): HistogramMetric;
}

function canonicalKey(labels?: MetricLabels): string {
  if (labels === undefined) return '';
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${String(labels[k])}`)
    .join('|');
}

class InMemoryCounter implements CounterMetric {
  private readonly values = new Map<string, { labels: MetricLabels; value: number }>();

  constructor(readonly name: string) {}

  add(labels?: MetricLabels, delta = 1): void {
    const key = canonicalKey(labels);
    const current = this.values.get(key);
    if (current === undefined) {
      this.values.set(key, { labels: { ...(labels ?? {}) }, value: delta });
    } else {
      current.value += delta;
    }
  }

  valueFor(labels?: MetricLabels): number {
    return this.values.get(canonicalKey(labels))?.value ?? 0;
  }

  total(): number {
    let sum = 0;
    for (const entry of this.values.values()) sum += entry.value;
    return sum;
  }

  snapshot(): Array<{ labels: MetricLabels; value: number }> {
    return [...this.values.values()].map((entry) => ({ labels: { ...entry.labels }, value: entry.value }));
  }
}

function summarize(values: number[]): HistogramSummary {
  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    count,
    sum,
    min: count > 0 ? sorted[0] : 0,
    max: count > 0 ? sorted[sorted.length - 1] : 0,
    p50: count > 0 ? sorted[Math.floor(count / 2)] : 0,
  };
}

class InMemoryHistogram implements HistogramMetric {
  private readonly values = new Map<string, { labels: MetricLabels; samples: number[] }>();

  constructor(readonly name: string) {}

  observe(labels: MetricLabels, valueMs: number): void {
    const key = canonicalKey(labels);
    const current = this.values.get(key);
    if (current === undefined) {
      this.values.set(key, { labels: { ...labels }, samples: [valueMs] });
    } else {
      current.samples.push(valueMs);
    }
  }

  valueFor(labels: MetricLabels): HistogramSummary {
    const entries = this.values.get(canonicalKey(labels));
    return summarize(entries === undefined ? [] : entries.samples);
  }

  total(): HistogramSummary {
    const all: number[] = [];
    for (const entry of this.values.values()) all.push(...entry.samples);
    return summarize(all);
  }
}

export class InMemoryMetrics implements MetricsCollector {
  private readonly counters = new Map<string, InMemoryCounter>();
  private readonly histograms = new Map<string, InMemoryHistogram>();

  counter(name: string): CounterMetric {
    let metric = this.counters.get(name);
    if (metric === undefined) {
      metric = new InMemoryCounter(name);
      this.counters.set(name, metric);
    }
    return metric;
  }

  histogram(name: string): HistogramMetric {
    let metric = this.histograms.get(name);
    if (metric === undefined) {
      metric = new InMemoryHistogram(name);
      this.histograms.set(name, metric);
    }
    return metric;
  }
}

/** Maps a correlation context to snake_case metric labels (only set fields). */
export function correlationLabels(ctx: CorrelationContext): MetricLabels {
  const labels: MetricLabels = {};
  if (ctx.generationId !== undefined) labels.generation_id = ctx.generationId;
  if (ctx.stage !== undefined) labels.stage = ctx.stage;
  if (ctx.attempt !== undefined) labels.attempt = ctx.attempt;
  if (ctx.projectId !== undefined) labels.project_id = ctx.projectId;
  if (ctx.userId !== undefined) labels.user_id = ctx.userId;
  if (ctx.jobId !== undefined) labels.job_id = ctx.jobId;
  return labels;
}