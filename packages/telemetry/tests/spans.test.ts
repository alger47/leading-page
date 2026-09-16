import { describe, expect, it } from 'vitest';
import { MemorySpanStore, createTraceId, trace } from '../src/index.js';

describe('MemorySpanStore', () => {
  it('records a successful span with duration', async () => {
    const store = new MemorySpanStore();
    const traceId = createTraceId();

    await trace(store, { name: 'engine.generate', kind: 'client', traceId }, () => undefined);

    const spans = store.spansForTrace(traceId);
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe('engine.generate');
    expect(spans[0].status).toBe('ok');
    expect(spans[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(spans[0].spanId).toBeTruthy();
  });

  it('marks the span failed when the callback fails with the provided code', async () => {
    const store = new MemorySpanStore();
    const traceId = createTraceId();

    await expect(
      trace(store, { name: 'planner', kind: 'internal', traceId }, async (handle) => {
        handle.fail('E-AI-004', 'still invalid after ladder');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const span = store.spansForTrace(traceId)[0];
    expect(span.status).toBe('error');
    expect(span.errorCode).toBe('E-AI-004');
    expect(span.errorMessage).toBe('still invalid after ladder');
  });

  it('uses the E-TRACE-001 code when the callback throws without an explicit fail', async () => {
    const store = new MemorySpanStore();
    const traceId = createTraceId();

    await expect(
      trace(
        store,
        { name: 'schema_builder', kind: 'internal', traceId },
        () => {
          throw new Error('unexpected');
        },
      ),
    ).rejects.toThrow('unexpected');

    const span = store.spansForTrace(traceId)[0];
    expect(span.errorCode).toBe('E-TRACE-001');
    expect(span.status).toBe('error');
  });

  it('segregates spans by trace id', async () => {
    const store = new MemorySpanStore();
    const a = createTraceId();
    const b = createTraceId();

    await trace(store, { name: 'a', kind: 'job', traceId: a }, () => undefined);
    await trace(store, { name: 'b', kind: 'job', traceId: b }, () => undefined);

    expect(store.spansForTrace(a).map((s) => s.name)).toEqual(['a']);
    expect(store.spansForTrace(b).map((s) => s.name)).toEqual(['b']);
    expect(store.all()).toHaveLength(2);
  });
});