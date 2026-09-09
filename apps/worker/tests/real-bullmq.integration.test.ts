/**
 * Optional end-to-end over a REAL BullMQ stack. Requires a reachable Redis
 * (REDIS_URL, default redis://127.0.0.1:6379). Skipped when Redis is absent so
 * the suite stays green offline; the in-memory driver covers the same behaviour
 * otherwise.
 */

import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';

import type { WorkerConfig } from '../src/config.js';
import { EngineClient } from '../src/engine/client.js';
import { makeProcessor } from '../src/processor.js';
import { makeBullQueue, makeRedis, startBullWorker } from '../src/queue/bullmq.js';
import { buildServer } from '../src/server.js';
import { MemoryJobStore } from '../src/store.js';
import { MemorySpanStore } from '../src/telemetry.js';
import type { FastifyInstance } from 'fastify';
import { makeFakeEngine } from './fake-engine.js';
import { waitFor } from './harness.js';

const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

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
  let fake: ReturnType<typeof makeFakeEngine> | undefined;

  async function start(skipEngine = false, workerPaused = false): Promise<void> {
    redis = makeRedis(redisUrl);
    await redis.ping();
    if (!skipEngine) {
      fake = makeFakeEngine();
      config.engineUrl = await fake.start();
    }
    const engine = new EngineClient({ baseUrl: config.engineUrl, token: config.engineToken, timeoutMs: config.engineTimeoutMs });
    store = new MemoryJobStore();
    spans = new MemorySpanStore();
    queue = makeBullQueue({
      queueName: config.queueName,
      connection: redis,
      maxAttempts: config.maxAttempts,
      retryAfterMs: config.retryAfterMs,
    });
    const processor = makeProcessor({ engine, store, spans });
    worker = startBullWorker({
      queueName: config.queueName,
      connection: redis,
      maxAttempts: config.maxAttempts,
      retryAfterMs: config.retryAfterMs,
      startPaused: workerPaused,
      processor: (job, token) => processor.run(job, token),
      onFailed: (id, error) => void processor.finalizeFailure(id, error),
    });
    app = buildServer({ store, spans, queue, engine, config });
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

  afterAll(async () => {
    await stop();
  });

  it('processes a job to completion through BullMQ', async () => {
    await start();
    const res = await app.inject({ method: 'POST', url: '/api/jobs', headers: { 'idempotency-key': 'bull-e2e-1' }, payload: { brief: 'Sell fitness kit', locale: 'en' } });
    expect(res.statusCode).toBe(202);
    const body = res.json() as { jobId: string };
    await waitFor(() => store.get(body.jobId)?.status === 'COMPLETED', 20_000);
    const record = store.get(body.jobId);
    expect(record?.attemptsMade).toBe(1);
    expect(record?.result?.page_validation?.valid).toBe(true);
  });

  it('fails with E-JOB-001 when transient errors are exhausted', async () => {
    await start();
    fake?.setScenario({ mode: 'transient' });
    const res = await app.inject({ method: 'POST', url: '/api/jobs', headers: { 'idempotency-key': 'bull-e2e-2' }, payload: { brief: 'Sell fitness kit', locale: 'en', budgetUsd: 2 } });
    expect(res.statusCode).toBe(202);
    const body = res.json() as { jobId: string };
    await waitFor(() => store.get(body.jobId)?.status === 'FAILED', 20_000);
    expect(store.get(body.jobId)?.errorCode).toBe('E-JOB-001');
  });
});