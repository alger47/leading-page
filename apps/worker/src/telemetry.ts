/**
 * Minimal in-process tracing (pre-OTel). Spans are recorded in a memory store
 * and exposed via the API; OTLP export is deferred to the persistence phase.
 * One trace per job; retries accumulate under the same trace id.
 */

import { randomUUID } from 'node:crypto';

export type SpanKind = 'job' | 'client' | 'internal';
export type SpanStatus = 'ok' | 'error';

export interface Span {
  traceId: string;
  spanId: string;
  parentId?: string;
  name: string;
  kind: SpanKind;
  startMs: number;
  endMs: number;
  durationMs: number;
  status: SpanStatus;
  attributes: Record<string, string | number | boolean>;
  errorCode?: string;
  errorMessage?: string;
}

export function newSpanId(): string {
  return randomUUID();
}

export function newTraceId(): string {
  return randomUUID();
}

export function createTraceId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface SpanStore {
  push(span: Span): void;
  spansForTrace(traceId: string): Span[];
}

export class MemorySpanStore implements SpanStore {
  private readonly spans: Span[] = [];

  push(span: Span): void {
    this.spans.push(span);
  }

  spansForTrace(traceId: string): Span[] {
    return this.spans.filter((s) => s.traceId === traceId);
  }

  all(): Span[] {
    return this.spans.slice();
  }
}

export interface SpanHandle {
  readonly spanId: string;
  fail(code: string, message?: string): void;
  addAttributes(attrs: Record<string, string | number | boolean>): void;
}

export interface SpanOptions {
  name: string;
  kind: SpanKind;
  traceId: string;
  parentId?: string;
  attributes?: Record<string, string | number | boolean>;
}

export async function trace<T>(
  store: SpanStore,
  opts: SpanOptions,
  fn: (handle: SpanHandle) => T | Promise<T>,
): Promise<T> {
  const span: Span = {
    traceId: opts.traceId,
    spanId: newSpanId(),
    parentId: opts.parentId,
    name: opts.name,
    kind: opts.kind,
    startMs: Date.now(),
    endMs: 0,
    durationMs: 0,
    status: 'ok',
    attributes: { ...(opts.attributes ?? {}) },
  };

  const handle: SpanHandle = {
    get spanId() {
      return span.spanId;
    },
    fail(code, message) {
      span.status = 'error';
      span.errorCode = code;
      if (message !== undefined) span.errorMessage = message;
    },
    addAttributes(attrs) {
      Object.assign(span.attributes, attrs);
    },
  };

  try {
    return await fn(handle);
  } catch (cause) {
    if (span.status === 'ok') {
      span.status = 'error';
      span.errorCode = 'E-TRACE-001';
      span.errorMessage = cause instanceof Error ? cause.message : String(cause);
    }
    throw cause;
  } finally {
    span.endMs = Date.now();
    span.durationMs = span.endMs - span.startMs;
    store.push(span);
  }
}