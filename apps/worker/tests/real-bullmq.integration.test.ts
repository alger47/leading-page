/**
 * Optional end-to-end over a REAL BullMQ stack. Requires a reachable Redis
 * (REDIS_URL, default redis://127.0.0.1:6379). Skipped when Redis is absent so
 * the suite stays green offline; the in-memory driver covers the same behaviour
 * otherwise.
 */

import { Redis } from 'ioredis';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import type { WorkerConfig } from '../src/config.js';
import { EngineClient } from '../src/engine/client.js';
import { makeProcessor } from '../src/processor.js';
import { makeBullQueue, makeRedis, startBullWorker } from '../src/queue/bullmq.js';
import { buildServer } from '../src/server.js';
import { MemoryAssetStore, MemoryJobStore } from '../src/store.js';
import { MemorySpanStore } from '../src/telemetry.js';
import type { FastifyInstance } from 'fastify';
import { makeFakeEngine } from './fake-engine.js';
import { waitFor } from './harness.js';

const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const AUTH_TOKEN = 'test-worker-token';

async function redisAvailable(): Promise<boolean> {
  const probe = new Redis(redisUrl, { maxRetriesPerRequest: 1, retryStrategy: () => null, lazyConnect: true });
  probe.on('error', () => undefined);
  const timer = setTimeout(() => undefined, 2000);
  try {
    await probe.connect();
    clearTimeout(timer);
    await probe.quit().catch(() => undefined);
    return true;
  } catch {
    clearTimeout(timer);
    return false;
  }
}

const describeOrSkip = (await redisAvailable()) ? describe : describe.skip;

describeOrSkip('real BullMQ stack (Redis present)', () => {
  const config: WorkerConfig = {
    port: 0,
    engineUrl: 'http://127.0.0.1:1',
    engineToken: 'test-token',
    apiToken: AUTH_TOKEN,
    queueName: `gen-bull-${Date.now()}`,
    redisUrl,
    engineTimeoutMs: 5_000,
    maxAttempts: 2,
    retryAfterMs: 20,
  };

  let redis: Redis;
  let queue: ReturnType<typeof makeBullQueue<never>>;
  let worker: { close(): Promise<void> };
  let app: FastifyInstance;
  let store: MemoryJobStore;
  let spans: MemorySpanStore;
  let assets: MemoryAssetStore;
  let fake: ReturnType<typeof makeFakeEngine> | undefined;

  async function start(skipEngine = false, workerPaused = false, overrides: Partial<WorkerConfig> = {}): Promise<void> {
    const cfg = { ...config, ...overrides };
    redis = makeRedis(redisUrl);
    await redis.ping();
    if (!skipEngine) {
      fake = makeFakeEngine();
      cfg.engineUrl = await fake.start();
    }
    const engine = new EngineClient({ baseUrl: cfg.engineUrl, token: cfg.engineToken, timeoutMs: cfg.engineTimeoutMs });
    store = new MemoryJobStore();
    spans = new MemorySpanStore();
    assets = new MemoryAssetStore();
    queue = makeBullQueue({
      queueName: cfg.queueName,
      connection: redis,
      maxAttempts: cfg.maxAttempts,
      retryAfterMs: cfg.retryAfterMs,
    });
    const processor = makeProcessor({ engine, store, spans, assets });
    worker = startBullWorker({
      queueName: cfg.queueName,
      connection: redis,
      maxAttempts: cfg.maxAttempts,
      retryAfterMs: cfg.retryAfterMs,
      startPaused: workerPaused,
      processor: (job, token) => processor.run(job, token),
      onFailed: (id, error) => void processor.finalizeFailure(id, error),
    });
    app = buildServer({ store, spans, queue, engine, config: cfg, assets });
    await app.listen({ port: 0, host: '127.0.0.1' });
  }

  async function stop(): Promise<void> {
    await app?.close();
    await worker?.close();
    await queue?.close();
    redis?.disconnect();
    await fake?.stop().catch(() => undefined);
    fake = undefined;
  }

  /** Tight status observer: captures every status change the store record
   * passes through, so an incorrect intermediate FAILED blip is caught. */
  async function observeStatuses(jobId: string): Promise<string[]> {
    const seen: string[] = [];
    const deadline = Date.now() + 20_000;
    for (;;) {
      const status = store.get(jobId)?.status;
      if (status !== undefined && seen[seen.length - 1] !== status) seen.push(status);
      if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED') return seen;
      if (Date.now() > deadline) throw new Error('job did not reach a terminal state in time');
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  }

  afterEach(async () => {
    await stop();
  });

  afterAll(async () => {
    await stop();
  });

  it('processes a job to completion through BullMQ', async () => {
    await start();
    const res = await app.inject({ method: 'POST', url: '/api/jobs', headers: { 'x-internal-token': AUTH_TOKEN, 'idempotency-key': 'bull-e2e-1' }, payload: { brief: 'Sell fitness kit', locale: 'en' } });
    expect(res.statusCode).toBe(202);
    const body = res.json() as { jobId: string };
    await waitFor(() => store.get(body.jobId)?.status === 'COMPLETED', 20_000);
    const record = store.get(body.jobId);
    expect(record?.attemptsMade).toBe(1);
    expect(record?.result?.page_validation?.valid).toBe(true);
  });

  it('fails with E-JOB-001 when transient errors are exhausted', async () => {
    await start();
    // BOTH attempts must hit the 503 so retries are actually spent; with only
    // one transient failure the job legitimately recovers to COMPLETED.
    fake?.setScenario({ mode: 'transient', transientRemaining: 2 });
    const res = await app.inject({ method: 'POST', url: '/api/jobs', headers: { 'x-internal-token': AUTH_TOKEN, 'idempotency-key': 'bull-e2e-2' }, payload: { brief: 'Sell fitness kit', locale: 'en', budgetUsd: 2 } });
    expect(res.statusCode).toBe(202);
    const body = res.json() as { jobId: string };
    await waitFor(() => store.get(body.jobId)?.status === 'FAILED', 20_000);
    expect(store.get(body.jobId)?.errorCode).toBe('E-JOB-001');
  });

  it('recovers to COMPLETED when only an intermediate attempt fails (F1 regression)', async () => {
    // The engine fails ONCE (transient 503) then succeeds on its retry. The
    // worker must NOT finalize the job as FAILED on that intermediate attempt:
    // BullMQ emits 'failed' before each retry -- only the exhausted attempt may
    // lock the record as FAILED (E-JOB-001).
    await start(false, false, { retryAfterMs: 250 });
    fake?.setScenario({ mode: 'transient', transientRemaining: 1 });
    const res = await app.inject({ method: 'POST', url: '/api/jobs', headers: { 'x-internal-token': AUTH_TOKEN, 'idempotency-key': 'bull-e2e-3' }, payload: { brief: 'Sell fitness kit', locale: 'en' } });
    expect(res.statusCode).toBe(202);
    const body = res.json() as { jobId: string };
    const seen = await observeStatuses(body.jobId);
    expect(seen.includes('FAILED')).toBe(false);
    expect(seen[seen.length - 1]).toBe('COMPLETED');
    const record = store.get(body.jobId);
    expect(record?.attemptsMade).toBe(2);
    expect(record?.result?.page_validation?.valid).toBe(true);
  });
});