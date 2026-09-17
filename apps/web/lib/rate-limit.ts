/**
 * In-memory token-bucket rate limiter for the web API (GAP-6: rate limiting).
 *
 * Hidden behind middleware.ts; caps per-IP request rate on /api/v1/*. The
 * bucket is per-process — single-instance deployments and local dev are fully
 * protected, multi-instance deployments should additionally front the API with
 * a CDN / API-gateway limiter. Clock and walls are injectable for tests.
 *
 * Env:
 *   RATE_LIMIT_CAPACITY            burst capacity (default 60)
 *   RATE_LIMIT_REFILL_PER_SECOND   steady refill (default 1)
 *   RATE_LIMIT_DISABLED=1          opt out (CI / internal tooling)
 */

export interface RateLimitConfig {
  capacity: number;
  refillPerSecond: number;
  disabled: boolean;
}

export interface RateLimitVerdict {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export function rateLimitConfig(
  env: Record<string, string | undefined> = process.env,
): RateLimitConfig {
  const parse = (raw: string | undefined, fallback: number) => {
    const value = Number.parseInt(raw ?? '', 10);
    return Number.isFinite(value) && value >= 1 ? value : fallback;
  };
  return {
    capacity: parse(env.RATE_LIMIT_CAPACITY, 60),
    refillPerSecond: parse(env.RATE_LIMIT_REFILL_PER_SECOND, 1),
    disabled: env.RATE_LIMIT_DISABLED === '1' || env.RATE_LIMIT_DISABLED === 'true',
  };
}

export class TokenBucketRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    readonly config: RateLimitConfig = rateLimitConfig(),
    private readonly now: () => number = () => Date.now(),
    private readonly maxKeys = 100_000,
  ) {}

  check(key: string): RateLimitVerdict {
    const nowMs = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.config.capacity, updatedAt: nowMs };
      if (this.buckets.size >= this.maxKeys) this.prune();
      this.buckets.set(key, bucket);
    }
    const elapsedSeconds = (nowMs - bucket.updatedAt) / 1000;
    bucket.tokens = Math.min(this.config.capacity, bucket.tokens + elapsedSeconds * this.config.refillPerSecond);
    bucket.updatedAt = nowMs;
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterSeconds: 0 };
    }
    const retryAfterSeconds = Math.max(1, Math.ceil((1 - bucket.tokens) / this.config.refillPerSecond));
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  private prune(): void {
    const entries = [...this.buckets.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    const drop = Math.ceil(entries.length * 0.2);
    for (const [key] of entries.slice(0, drop)) this.buckets.delete(key);
  }
}

export function createRateLimiter(
  env: Record<string, string | undefined> = process.env,
): TokenBucketRateLimiter {
  const config = rateLimitConfig(env);
  return new TokenBucketRateLimiter(config);
}