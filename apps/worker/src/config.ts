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

export const DEV_WORKER_TOKEN = 'dev-worker-token';
export const DEV_ENGINE_TOKEN = 'dev-internal-token';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const maxAttempts = intFromEnv('MAX_ATTEMPTS', 3);
  return {
    port: intFromEnv('PORT', 8080),
    engineUrl: env.AI_ENGINE_URL ?? 'http://localhost:8000',
    engineToken: env.AI_INTERNAL_TOKEN ?? DEV_ENGINE_TOKEN,
    apiToken: env.WORKER_INTERNAL_TOKEN ?? DEV_WORKER_TOKEN,
    queueName: env.QUEUE_NAME ?? 'generation-jobs',
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
    engineTimeoutMs: intFromEnv('ENGINE_TIMEOUT_MS', 120_000),
    maxAttempts,
    retryAfterMs: intFromEnv('RETRY_AFTER_MS', 1_000),
  };
}

/**
 * Fail-closed guard (Phase 14 §12.4): refuse to boot in production while any
 * internal token is still the dev default, otherwise an attacker who can reach
 * the worker API would just present the well-known default token.
 */
export function assertProdConfig(config: WorkerConfig, env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;
  const problems: string[] = [];
  if (config.apiToken === DEV_WORKER_TOKEN) problems.push('WORKER_INTERNAL_TOKEN');
  if (config.engineToken === DEV_ENGINE_TOKEN) problems.push('AI_INTERNAL_TOKEN');
  if (problems.length > 0) {
    throw new Error(
      `refusing to start worker in production: ${problems.join(', ')} still uses the dev default. ` +
        'Set real secrets (32+ random bytes) before deploying.',
    );
  }
}