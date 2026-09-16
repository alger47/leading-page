/** Structured JSON logging with correlation context and child binding. */

import type { CorrelationContext, TelemetryAttrs } from './types.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LogEntry {
  ts: string;
  level: LogLevel;
  msg: string;
  ctx?: CorrelationContext;
  attrs?: TelemetryAttrs;
  err?: { code?: string; message?: string };
}

export interface Logger {
  debug(msg: string, attrs?: TelemetryAttrs): void;
  info(msg: string, attrs?: TelemetryAttrs): void;
  warn(msg: string, attrs?: TelemetryAttrs): void;
  error(msg: string, error?: unknown, attrs?: TelemetryAttrs): void;
  child(ctx: CorrelationContext): Logger;
}

export interface LogSink {
  write(entry: LogEntry): void;
}

/** Sink that prints one compact JSON line per entry (stdout for samples). */
export class ConsoleLogSink implements LogSink {
  constructor(private readonly minLevel: LogLevel = 'info') {}

  write(entry: LogEntry): void {
    if (LEVEL_RANK[entry.level] < LEVEL_RANK[this.minLevel]) return;
    console[entry.level](JSON.stringify(entry));
  }
}

/** Null sink for tests / silent environments. */
export class NoopLogSink implements LogSink {
  write(_entry: LogEntry): void {}
}

function toErrorInfo(error: unknown): { code?: string; message?: string } | undefined {
  if (error === undefined) return undefined;
  if (error instanceof Error) {
    const code = (error as Error & { code?: string }).code;
    return { ...(code !== undefined ? { code } : {}), message: error.message };
  }
  return { message: String(error) };
}

export class ConsoleLogger implements Logger {
  constructor(
    private readonly sink: LogSink = new ConsoleLogSink(),
    private readonly ctx: CorrelationContext = {},
  ) {}

  debug(msg: string, attrs?: TelemetryAttrs): void {
    this.emit('debug', msg, undefined, attrs);
  }

  info(msg: string, attrs?: TelemetryAttrs): void {
    this.emit('info', msg, undefined, attrs);
  }

  warn(msg: string, attrs?: TelemetryAttrs): void {
    this.emit('warn', msg, undefined, attrs);
  }

  error(msg: string, error?: unknown, attrs?: TelemetryAttrs): void {
    this.emit('error', msg, error, attrs);
  }

  child(ctx: CorrelationContext): Logger {
    return new ConsoleLogger(this.sink, { ...this.ctx, ...ctx });
  }

  private emit(level: LogLevel, msg: string, error?: unknown, attrs?: TelemetryAttrs): void {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...(Object.keys(this.ctx).length > 0 ? { ctx: this.ctx } : {}),
      ...(attrs !== undefined && Object.keys(attrs).length > 0 ? { attrs } : {}),
      ...(error !== undefined ? { err: toErrorInfo(error) } : {}),
    };
    this.sink.write(entry);
  }
}

export function createLogger(minLevel?: LogLevel): Logger {
  return new ConsoleLogger(new ConsoleLogSink(minLevel));
}