/**
 * Runtime configuration for the web app. Fail-fast on malformed values;
 * secrets and tokens are never logged.
 */

export interface WebConfig {
  databaseUrl: string;
  workerUrl: string;
  sessionCookieName: string;
  csrfCookieName: string;
  sessionTtlMs: number;
  isProd: boolean;
}

export function webConfig(env: NodeJS.ProcessEnv = process.env): WebConfig {
  const ttlDays = Number.parseInt(env.SESSION_TTL_DAYS ?? '30', 10);
  if (Number.isNaN(ttlDays) || ttlDays <= 0) throw new Error('invalid SESSION_TTL_DAYS');
  return {
    databaseUrl: env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/landing_ai',
    workerUrl: (env.WORKER_URL ?? 'http://localhost:8080').replace(/\/+$/, ''),
    sessionCookieName: env.SESSION_COOKIE_NAME ?? 'sid',
    csrfCookieName: env.CSRF_COOKIE_NAME ?? 'csrf',
    sessionTtlMs: ttlDays * 24 * 60 * 60 * 1000,
    isProd: env.NODE_ENV === 'production',
  };
}

export const config = webConfig();