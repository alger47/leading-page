/** Shared telemetry value types. */

export type TelemetryValue = string | number | boolean;

export type TelemetryAttrs = Record<string, TelemetryValue>;

/**
 * Correlation context carried on every log / metric / span (architecture.md §12).
 * The platform rule: every telemetry record carries generationId, stage, attempt,
 * projectId, userId where available.
 */
export interface CorrelationContext {
  generationId?: string;
  stage?: string;
  attempt?: number;
  projectId?: string;
  userId?: string;
  jobId?: string;
  sessionId?: string;
}