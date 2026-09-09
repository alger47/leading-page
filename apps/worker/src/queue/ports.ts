/**
 * Queue port abstractions. Production uses BullMQ (queue/bullmq.ts); tests use
 * an in-memory driver (queue/memory.ts) that still exercises the real
 * processor, retry/backoff semantics and failure finalization.
 */

export interface JobLike {
  readonly id: string;
  readonly data: unknown;
  readonly attemptsMade: number;
  moveToFailed(err: Error, token?: string): Promise<void>;
}

export interface EnqueueDriver<T> {
  readonly name: string;
  add(data: T, opts: { jobId: string }): Promise<{ id: string }>;
  remove(id: string): Promise<void>;
  close(): Promise<void>;
}

export interface WorkerSettings {
  queueName: string;
  maxAttempts: number;
  retryAfterMs: number;
  processor: (job: JobLike, token?: string) => Promise<void>;
  onFailed: (id: string, error: Error) => void;
  concurrency?: number;
  startPaused?: boolean;
}

export interface WorkerHandle {
  resume(): Promise<void>;
  pause(): Promise<void>;
  close(): Promise<void>;
}