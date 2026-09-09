/**
 * Test harness: in-memory queue + worker (queue/memory.ts) driving the real
 * processor, a fake engine over HTTP, and the fastify API app sharing one
 * in-memory store/spans. Runs the full lifecycle without a Redis server.
 */

import type { FastifyInstance } from 'fastify';

import type { WorkerConfig } from '../src/config.js';
import { EngineClient } from '../src/engine/client.js';
import { makeProcessor } from '../src/processor.js';
import type { JobPayload } from '../src/jobs/types.js';
import { makeMemoryDriver } from '../src/queue/memory.js';
import type { EnqueueDriver, WorkerHandle } from '../src/queue/ports.js';
import { buildServer } from '../src/server.js';
import { MemoryJobStore } from '../src/store.js';
import { MemorySpanStore } from '../src/telemetry.js';
import { makeFakeEngine, type FakeEngine, type Scenario } from './fake-engine.js';

export interface HarnessOptions {
  scenario?: Scenario;
  maxAttempts?: number;
  retryAfterMs?: number;
  engineTimeoutMs?: number;
  queueName?: string;
  includeWorker?: boolean;
  engineBaseOverride?: string;
}

export interface Harness {
  store: MemoryJobStore;
  spans: MemorySpanStore;
  queue: EnqueueDriver<JobPayload>;
  worker?: WorkerHandle;
  app: FastifyInstance;
  fake?: FakeEngine;
  engineBase: string;
  resumeWorker(): Promise<void>;
  close(): Promise<void>;
}

export async function makeHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const retryAfterMs = opts.retryAfterMs ?? 20;
  const engineTimeoutMs = opts.engineTimeoutMs ?? 5_000;
  const queueName = opts.queueName ?? `gen-${Math.random().toString(36).slice(2, 10)}`;

  const fake = opts.engineBaseOverride === undefined ? makeFakeEngine() : undefined;
  fake?.setScenario(opts.scenario ?? { mode: 'ok' });
  let engineBase = opts.engineBaseOverride;
  if (engineBase === undefined) {
    engineBase = await fake!.start();
  }

  const engine = new EngineClient({ baseUrl: engineBase, token: 'test-token', timeoutMs: engineTimeoutMs });
  const store = new MemoryJobStore();
  const spans = new MemorySpanStore();

  const includeWorker = opts.includeWorker !== false;
  const processor = includeWorker ? makeProcessor({ engine, store, spans }) : undefined;
  const running = makeMemoryDriver<JobPayload>(queueName, {
    maxAttempts,
    retryAfterMs,
    startPaused: true,
    ...(processor === undefined
      ? {}
      : {
          processor: (job: import('../src/queue/ports.js').JobLike, token?: string) => processor.run(job, token),
          onFailed: (id: string, error: Error) => void processor.finalizeFailure(id, error),
        }),
  });
  const worker: WorkerHandle | undefined = includeWorker ? running.worker : undefined;
  const queue = running.queue;

  const config: WorkerConfig = {
    port: 0,
    engineUrl: engineBase,
    engineToken: 'test-token',
    queueName,
    redisUrl: 'redis://memory',
    engineTimeoutMs,
    maxAttempts,
    retryAfterMs,
  };

  const app = buildServer({ store, spans, queue, engine, config });

  return {
    store,
    spans,
    queue,
    worker,
    app,
    fake,
    engineBase,
    resumeWorker: async () => {
      await worker?.resume();
    },
    async close() {
      if (worker !== undefined) await worker.close();
      await queue.close();
      await app.close();
      await fake?.stop();
    },
  };
}

export async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 15_000, intervalMs = 25): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) return;
    if (Date.now() > deadline) throw new Error('condition not met within timeout');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}