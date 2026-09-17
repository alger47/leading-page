/** Token-bucket rate limiter behaviour (GAP-6). */

import { describe, expect, it } from 'vitest';
import { TokenBucketRateLimiter, rateLimitConfig } from '../lib/rate-limit.js';

describe('rateLimitConfig', () => {
  it('applies defaults', () => {
    const config = rateLimitConfig({});
    expect(config.capacity).toBe(60);
    expect(config.refillPerSecond).toBe(1);
    expect(config.disabled).toBe(false);
  });

  it('parses env overrides and the disable flag', () => {
    const config = rateLimitConfig({
      RATE_LIMIT_CAPACITY: '10',
      RATE_LIMIT_REFILL_PER_SECOND: '2',
      RATE_LIMIT_DISABLED: 'true',
    });
    expect(config.capacity).toBe(10);
    expect(config.refillPerSecond).toBe(2);
    expect(config.disabled).toBe(true);
  });

  it('ignores non-numeric values', () => {
    const config = rateLimitConfig({ RATE_LIMIT_CAPACITY: 'many' });
    expect(config.capacity).toBe(60);
  });
});

describe('TokenBucketRateLimiter', () => {
  it('allows up to capacity in a burst, then rejects', () => {
    let now = 1_000_000;
    const limiter = new TokenBucketRateLimiter(
      { capacity: 3, refillPerSecond: 1, disabled: false },
      () => now,
    );
    for (let i = 0; i < 3; i++) {
      const verdict = limiter.check('ip');
      expect(verdict.allowed).toBe(true);
      expect(verdict.remaining).toBe(2 - i);
    }
    expect(limiter.check('ip').allowed).toBe(false);
    expect(limiter.check('ip').retryAfterSeconds).toBe(1);
  });

  it('refills over time', () => {
    let now = 1_000_000;
    const limiter = new TokenBucketRateLimiter(
      { capacity: 1, refillPerSecond: 1, disabled: false },
      () => now,
    );
    expect(limiter.check('ip').allowed).toBe(true);
    expect(limiter.check('ip').allowed).toBe(false);
    now += 2_000;
    const verdict = limiter.check('ip');
    expect(verdict.allowed).toBe(true);
  });

  it('tracks keys independently', () => {
    let now = 1_000_000;
    const limiter = new TokenBucketRateLimiter(
      { capacity: 1, refillPerSecond: 1, disabled: false },
      () => now,
    );
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('b').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);
  });

  it('does not over-capacity after an idle period', () => {
    let now = 1_000_000;
    const limiter = new TokenBucketRateLimiter(
      { capacity: 4, refillPerSecond: 2, disabled: false },
      () => now,
    );
    now += 120_000;
    for (let i = 0; i < 4; i++) expect(limiter.check('ip').allowed).toBe(true);
    expect(limiter.check('ip').allowed).toBe(false);
  });
});