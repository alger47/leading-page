/**
 * Runtime configuration for the web app. Fail-fast on malformed values;
 * secrets and tokens are never logged.
 */

export interface WebConfig {
  databaseUrl: string;
  workerUrl: string;
  /** Shared internal token sent as X-Internal-Token to the worker API. */
  workerToken: string;
  sessionCookieName: string;
  csrfCookieName: string;
  sessionTtlMs: number;
  isProd: boolean;
  /**
   * Whether session/CSRF cookies carry the `Secure` flag (HTTPS-only). Defaults
   * to true in production; `COOKIE_SECURE` overrides explicitly (Phase 15) so a
   * plain-HTTP container stack can still log in during a dry-run.
   */
  secureCookies: boolean;
  /** Platform base URL for published pages (dev: http://localhost:3000). */
  publicBaseUrl: string;
  /** Host suffix auto-assigned to published pages ("username.platform.tld" equivalent). */
  publicHostSuffix: string;
}

/** Well-known local-development worker token — forbidden in production (§12.4). */
export const DEV_WORKER_TOKEN = 'dev-worker-token';

function secureCookiesFromEnv(env: NodeJS.ProcessEnv): boolean {
  if (env.COOKIE_SECURE !== undefined) {
    return env.COOKIE_SECURE === '1' || env.COOKIE_SECURE.toLowerCase() === 'true';
  }
  return env.NODE_ENV === 'production';
}

export function webConfig(env: NodeJS.ProcessEnv = process.env): WebConfig {
  const ttlDays = Number.parseInt(env.SESSION_TTL_DAYS ?? '30', 10);
  if (Number.isNaN(ttlDays) || ttlDays <= 0) throw new Error('invalid SESSION_TTL_DAYS');
  return {
    databaseUrl: env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/landing_ai',
    workerUrl: (env.WORKER_URL ?? 'http://localhost:8080').replace(/\/+$/, ''),
    workerToken: env.WORKER_INTERNAL_TOKEN ?? DEV_WORKER_TOKEN,
    sessionCookieName: env.SESSION_COOKIE_NAME ?? 'sid',
    csrfCookieName: env.CSRF_COOKIE_NAME ?? 'csrf',
    sessionTtlMs: ttlDays * 24 * 60 * 60 * 1000,
    isProd: env.NODE_ENV === 'production',
    secureCookies: secureCookiesFromEnv(env),
    publicBaseUrl: (env.PUBLIC_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
    publicHostSuffix: env.PUBLIC_HOST_SUFFIX ?? 'landing-ai.test',
  };
}

export const config = webConfig();