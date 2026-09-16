export { ConsoleLogger, ConsoleLogSink, NoopLogSink, createLogger } from './logger.js';
export type { LogEntry, LogLevel, LogSink, Logger } from './logger.js';

export { MemorySpanStore, createTraceId, newSpanId, newTraceId, trace } from './spans.js';
export type { Span, SpanHandle, SpanKind, SpanOptions, SpanStatus, SpanStore } from './spans.js';

export { InMemoryMetrics, correlationLabels } from './metrics.js';
export type {
  CounterMetric,
  HistogramMetric,
  HistogramSummary,
  MetricLabels,
  MetricsCollector,
} from './metrics.js';

export type { CorrelationContext, TelemetryAttrs, TelemetryValue } from './types.js';