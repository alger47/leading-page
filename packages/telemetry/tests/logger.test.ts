import { describe, expect, it } from 'vitest';
import { ConsoleLogger, NoopLogSink } from '../src/index.js';
import type { Logger } from '../src/index.js';

describe('ConsoleLogger', () => {
  it('emits a structured entry with correlation context', () => {
    const entries: unknown[] = [];
    const sink: NoopLogSink = {
      write: (entry) => entries.push(entry),
    } as unknown as NoopLogSink;

    const logger: Logger = new ConsoleLogger(sink);
    logger.child({ generationId: 'gen_123', stage: 'planner' }).info('stage started', { attempts: 1 });

    expect(entries).toHaveLength(1);
    const entry = entries[0] as {
      level: string;
      msg: string;
      ctx: Record<string, string>;
      attrs: Record<string, number>;
    };
    expect(entry.level).toBe('info');
    expect(entry.msg).toBe('stage started');
    expect(entry.ctx.generationId).toBe('gen_123');
    expect(entry.ctx.stage).toBe('planner');
    expect(entry.attrs.attempts).toBe(1);
  });

  it('records error code and message on error entries', () => {
    const entries: unknown[] = [];
    const sink: NoopLogSink = { write: (entry) => entries.push(entry) } as unknown as NoopLogSink;
    const logger: Logger = new ConsoleLogger(sink);

    const cause = new Error('boom');
    (cause as Error & { code?: string }).code = 'E-AI-004';
    logger.error('stage failed', cause);

    const entry = entries[0] as { err: { code: string; message: string } };
    expect(entry.err.code).toBe('E-AI-004');
    expect(entry.err.message).toBe('boom');
  });

  it('child context overrides parent context keys', () => {
    const entries: unknown[] = [];
    const sink: NoopLogSink = { write: (entry) => entries.push(entry) } as unknown as NoopLogSink;
    const logger: Logger = new ConsoleLogger(sink);

    logger.child({ generationId: 'parent' }).child({ generationId: 'child' }).info('x');
    const entry = entries[0] as { ctx: Record<string, string> };
    expect(entry.ctx.generationId).toBe('child');
  });
});