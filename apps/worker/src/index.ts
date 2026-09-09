/**
 * Worker entrypoint: wires config, redis, engine client, queue, processor,
 * API and graceful shutdown. Run with `pnpm dev` (tsx) or `pnpm start`
 * (compiled dist).
 */

import { loadConfig } from './config.js';
import { EngineClient } from './engine/client.js';
import { makeProcessor } from './processor.js';
import { makeBullQueue, makeRedis, startBullWorker } from './queue/bullmq.js';
import { buildServer } from './server.js';
import { MemoryJobStore } from './store.js';
import { MemorySpanStore } from './telemetry.js';

async function main(): Promise<void> {
  const config = loadConfig();

  const redis = makeRedis(config.redisUrl);
  try {
    await redis.ping();
  } catch (cause) {
    redis.disconnect();
    console.error(`[worker] cannot reach Redis at ${config.redisUrl}: ${cause instanceof Error ? cause.message : cause}`);
    console.error('[worker] start a local Redis (e.g. `docker run -p 6379:6379 redis:7`) and retry.');
    process.exit(1);
  }

  const connection = redis;
  const store = new MemoryJobStore();
  const spans = new MemorySpanStore();
  const engine = new EngineClient({ baseUrl: config.engineUrl, token: config.engineToken, timeoutMs: config.engineTimeoutMs });
  const processor = makeProcessor({ engine, store, spans });
  const queue = makeBullQueue<import('./jobs/types.js').JobPayload>({
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

  const app = buildServer({ store, spans, queue, engine, config });
  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`[worker] serving /api/jobs on :${config.port}; queue=${config.queueName}; engine=${config.engineUrl}`);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[worker] ${signal} received, shutting down`);
    await app.close();
    await worker.close();
    await queue.close();
    redis.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();