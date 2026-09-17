/**
 * Worker entrypoint: wires config, redis, engine client, queue, processor,
 * API and graceful shutdown. Run with `pnpm dev` (tsx) or `pnpm start`
 * (compiled dist).
 *
 * Queue backends:
 *   - default (REDIS_URL=redis://...)  → BullMQ over real Redis (production)
 *   - REDIS_URL=memory://              → in-memory queue (local dev with no
 *     Redis/Docker; same processor, retry/backoff and failure finalization —
 *     the driver used by the test harness and the web e2e bridge).
 */

import { loadConfig, assertProdConfig } from './config.js';
import { EngineClient } from './engine/client.js';
import { makeProcessor } from './processor.js';
import { makeBullQueue, makeRedis, startBullWorker } from './queue/bullmq.js';
import { makeMemoryDriver } from './queue/memory.js';
import type { EnqueueDriver, WorkerHandle } from './queue/ports.js';
import { buildServer } from './server.js';
import { MemoryJobStore } from './store.js';
import { MemorySpanStore } from './telemetry.js';
import type { JobPayload } from './jobs/types.js';
import type { Redis } from 'ioredis';

interface QueueBackend {
  queue: EnqueueDriver<JobPayload>;
  worker: WorkerHandle;
}

function isMemoryRedis(url: string): boolean {
  return url === 'memory://' || url.startsWith('redis://memory');
}

async function main(): Promise<void> {
  const config = loadConfig();
  assertProdConfig(config);

  const store = new MemoryJobStore();
  const spans = new MemorySpanStore();
  const engine = new EngineClient({ baseUrl: config.engineUrl, token: config.engineToken, timeoutMs: config.engineTimeoutMs });

  let backend: QueueBackend;
  let redis: Redis | undefined;

  if (isMemoryRedis(config.redisUrl)) {
    const processor = makeProcessor({ engine, store, spans });
    const driver = makeMemoryDriver<JobPayload>(config.queueName, {
      maxAttempts: config.maxAttempts,
      retryAfterMs: config.retryAfterMs,
      startPaused: false,
      processor: (job, token) => processor.run(job, token),
      onFailed: (jobId, failedReason) => void processor.finalizeFailure(jobId, failedReason),
    });
    backend = { queue: driver.queue, worker: driver.worker };
    console.log(`[worker] memory queue mode (REDIS_URL=${config.redisUrl}) — no Redis required`);
  } else {
    const connection = makeRedis(config.redisUrl);
    try {
      await connection.ping();
    } catch (cause) {
      connection.disconnect();
      console.error(`[worker] cannot reach Redis at ${config.redisUrl}: ${cause instanceof Error ? cause.message : cause}`);
      console.error('[worker] start a local Redis (e.g. `docker run -p 6379:6379 redis:7`) or set REDIS_URL=memory:// for the in-memory queue.');
      process.exit(1);
    }
    redis = connection;

    const processor = makeProcessor({ engine, store, spans });
    const queue = makeBullQueue<JobPayload>({
      queueName: config.queueName,
      connection,
      maxAttempts: config.maxAttempts,
      retryAfterMs: config.retryAfterMs,
    });
    const worker = startBullWorker({
      queueName: config.queueName,
      connection,
      maxAttempts: config.maxAttempts,
      retryAfterMs: config.retryAfterMs,
      processor: (job, token) => processor.run(job, token),
      onFailed: (jobId, failedReason) => void processor.finalizeFailure(jobId, failedReason),
      onStalled: (jobId) => {
        console.warn(`[worker] job ${jobId} stalled; recovery will re-process it (E-JOB-005)`);
      },
    });
    backend = { queue, worker };
  }

  const app = buildServer({ store, spans, queue: backend.queue, engine, config });
  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`[worker] serving /api/jobs on :${config.port}; queue=${config.queueName}; engine=${config.engineUrl}`);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[worker] ${signal} received, shutting down`);
    await app.close();
    await backend.worker.close();
    await backend.queue.close();
    redis?.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();