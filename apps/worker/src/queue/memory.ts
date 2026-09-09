/**
 * In-memory queue + worker for tests. Replaces BullMQ/ioredis-mock (whose Lua
 * support cannot run BullMQ scripts) while preserving the contract the
 * processor relies on:
 *   - add() de-duplicates by job id (like BullMQ),
 *   - transient throws are retried with exponential backoff up to maxAttempts,
 *     then hand the job to onFailed (exhaustion),
 *   - non-retryable failures are consumed through JobLike.moveToFailed.
 */

import type { EnqueueDriver, JobLike, WorkerHandle } from './ports.js';

export interface MemorySettings {
  maxAttempts: number;
  retryAfterMs: number;
  processor?: (job: JobLike, token?: string) => Promise<void>;
  onFailed?: (id: string, error: Error) => void;
  startPaused?: boolean;
}

interface Pending<T> {
  id: string;
  data: T;
}

export interface MemoryDriver<T> {
  queue: EnqueueDriver<T>;
  worker: WorkerHandle;
}

export function makeMemoryDriver<T>(queueName: string, settings: MemorySettings): MemoryDriver<T> {
  const pending: Pending<T>[] = [];
  const byId = new Set<string>();
  let paused = settings.startPaused !== false;
  let closed = false;
  let draining = false;

  async function processOne(item: Pending<T>): Promise<void> {
    const processor = settings.processor;
    if (processor === undefined) return;
    let attempt = 1;
    for (;;) {
      let movedToFailed = false;
      const jobLike: JobLike = {
        id: item.id,
        data: item.data,
        attemptsMade: attempt,
        moveToFailed: async () => {
          movedToFailed = true;
        },
      };
      try {
        await processor(jobLike);
        return; // either completed, or already moved to failed by the processor
      } catch (cause) {
        void movedToFailed;
        if (attempt < settings.maxAttempts) {
          attempt += 1;
          await new Promise((resolve) => setTimeout(resolve, settings.retryAfterMs));
        } else if (settings.onFailed !== undefined) {
          settings.onFailed(item.id, cause instanceof Error ? cause : new Error(String(cause)));
          return;
        } else {
          throw cause;
        }
      }
    }
  }

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      for (;;) {
        if (paused || closed || pending.length === 0) break;
        const item = pending.shift();
        if (item === undefined) break;
        byId.delete(item.id);
        await processOne(item);
      }
    } finally {
      draining = false;
    }
  }

  return {
    queue: {
      name: queueName,
      async add(data, opts) {
        if (closed) throw new Error(`queue ${queueName} is closed`);
        if (byId.has(opts.jobId)) return { id: opts.jobId };
        byId.add(opts.jobId);
        pending.push({ id: opts.jobId, data });
        void drain();
        return { id: opts.jobId };
      },
      async remove(id) {
        const at = pending.findIndex((item) => item.id === id);
        if (at >= 0) pending.splice(at, 1);
        byId.delete(id);
      },
      async close() {
        closed = true;
        pending.length = 0;
        byId.clear();
      },
    },
    worker: {
      async resume() {
        paused = false;
        await drain();
      },
      async pause() {
        paused = true;
      },
      async close() {
        closed = true;
        pending.length = 0;
        byId.clear();
      },
    },
  };
}