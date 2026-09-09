/**
 * BullMQ-backed queue + worker (§10.2). Drives the same processor that tests
 * run via the in-memory driver (queue/memory.ts), so behaviour stays identical
 * while the whole suite remains runnable without a Redis server.
 */

import { type Job, type JobsOptions, Queue, type QueueOptions, Worker, type WorkerOptions } from 'bullmq';
import { Redis } from 'ioredis';

import type { EnqueueDriver, JobLike, WorkerHandle } from './ports.js';

export interface BullSettings {
  queueName: string;
  connection: unknown;
  maxAttempts: number;
  retryAfterMs: number;
}

const defaultJobOptions = (settings: BullSettings): JobsOptions => ({
  attempts: settings.maxAttempts,
  backoff: { type: 'exponential', delay: settings.retryAfterMs },
  removeOnComplete: { count: 500 },
  removeOnFail: { count: 500 },
});

export function makeBullQueue<T>(settings: BullSettings): EnqueueDriver<T> {
  const options: QueueOptions = {
    connection: settings.connection as Redis,
    defaultJobOptions: defaultJobOptions(settings),
  };
  const queue = new Queue<T, T, string, T, T, string>(settings.queueName, options);
  return {
    name: queue.name,
    async add(data, opts) {
      const job = await queue.add(settings.queueName, data, { jobId: opts.jobId });
      return { id: job.id ?? opts.jobId };
    },
    async remove(id) {
      try {
        await queue.remove(id);
      } catch {
        /* already gone */
      }
    },
    async close() {
      await queue.close();
    },
  };
}

export function toJobLike(job: Job): JobLike {
  return {
    id: job.id ?? 'none',
    data: job.data,
    attemptsMade: job.attemptsMade,
    moveToFailed: async (err, token) => {
      await job.moveToFailed(err, token ?? '', true);
    },
  };
}

export interface BullWorkerSettings {
  queueName: string;
  connection: unknown;
  maxAttempts: number;
  retryAfterMs: number;
  processor: (job: JobLike, token?: string) => Promise<void>;
  onFailed: (id: string, error: Error) => void;
  onStalled?: (jobId: string) => void;
  startPaused?: boolean;
}

export function startBullWorker(settings: BullWorkerSettings): WorkerHandle {
  const options: WorkerOptions = {
    connection: settings.connection as Redis,
    concurrency: 1,
    lockDuration: 300_000,
    stalledInterval: 30_000,
    maxStalledCount: 1,
  };
  const worker = new Worker(
    settings.queueName,
    (job, token) => settings.processor(toJobLike(job), token),
    options,
  );
  worker.on('failed', (job, failedReason) => {
    if (job !== undefined && job.id !== undefined) {
      settings.onFailed(job.id, failedReason instanceof Error ? failedReason : new Error(String(failedReason)));
    }
  });
  if (settings.onStalled !== undefined) {
    worker.on('stalled', (jobId) => settings.onStalled?.(jobId));
  }
  if (settings.startPaused === true) {
    void worker.pause();
  }
  return {
    resume: async () => {
      await worker.resume();
    },
    pause: async () => {
      await worker.pause();
    },
    close: async () => {
      await worker.close();
    },
  };
}

/** Reusable redis connection for the production stack (queue + worker share it). */
export function makeRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}