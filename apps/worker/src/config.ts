/**
 * Worker environment configuration. Every knob is overridable via env vars;
 * defaults bias toward local development with the stub AI engine.
 */

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value < 0) throw new Error(`invalid ${name} (expected integer): ${raw}`);
  return value;
}

export interface WorkerConfig {
  port: number;
  engineUrl: string;
  engineToken: string;
  /** Token required on the worker's own HTTP API (X-Internal-Token). */
  apiToken: string;
  queueName: string;
  redisUrl: string;
  engineTimeoutMs: number;
  maxAttempts: number;
  retryAfterMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const maxAttempts = intFromEnv('MAX_ATTEMPTS', 3);
  return {
    port: intFromEnv('PORT', 8080),
    engineUrl: env.AI_ENGINE_URL ?? 'http://localhost:8000',
    engineToken: env.AI_INTERNAL_TOKEN ?? 'dev-internal-token',
    apiToken: env.WORKER_INTERNAL_TOKEN ?? 'dev-worker-token',
    queueName: env.QUEUE_NAME ?? 'generation-jobs',
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
    engineTimeoutMs: intFromEnv('ENGINE_TIMEOUT_MS', 120_000),
    maxAttempts,
    retryAfterMs: intFromEnv('RETRY_AFTER_MS', 1_000),
  };
}