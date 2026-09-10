/**
 * Generation idempotency-key and job-id derivation. Records in the DB and on
 * the worker share ONE job id: `gen_<sha256(key)[0:24]>`. A client-supplied
 * key is honored verbatim; otherwise the key embeds the page + a retry nonce
 * so a fresh attempt after a terminal failure is deterministically a NEW job.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { jobIdForIdempotencyKey, deriveIdempotencyKey, retryNonceFor } from '../lib/generation-key.js';

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

describe('job id derivation (must match worker enqueueJobId)', () => {
  it('prefixes with gen_ and truncates to 24 hex chars', () => {
    const id = jobIdForIdempotencyKey('a-vocabulaire-key');
    expect(id.startsWith('gen_')).toBe(true);
    expect(id.length).toBe(4 + 24); // 'gen_' + 24
    expect(id).toMatch(/^gen_[0-9a-f]{24}$/);
  });

  it('is deterministic', () => {
    expect(jobIdForIdempotencyKey('doc:u1:p1:0')).toBe(jobIdForIdempotencyKey('doc:u1:p1:0'));
  });

  it('differs across keys', () => {
    expect(jobIdForIdempotencyKey('doc:u1:p1:0')).not.toBe(jobIdForIdempotencyKey('doc:u1:p1:1'));
    expect(jobIdForIdempotencyKey('a')).not.toBe(jobIdForIdempotencyKey('b'));
  });

  it('matches the worker enqueueJobId convention (24-char sha256)', () => {
    // The worker computes gen_ + sha256(key).hex.slice(0,24); assert that independently.
    const id = jobIdForIdempotencyKey('any value');
    expect(id).toBe(`gen_${sha256('any value').slice(0, 24)}`);
  });
});

describe('idempotency key derivation', () => {
  it('honors a client-supplied key', () => {
    expect(deriveIdempotencyKey('u', 'p', 3, 'my-client-key')).toBe('my-client-key');
  });

  it('uses the doc:user:page:nonce scheme when no client key', () => {
    expect(deriveIdempotencyKey('u1', 'p1', 0)).toBe('doc:u1:p1:0');
    expect(deriveIdempotencyKey('u1', 'p1', 2)).toBe('doc:u1:p1:2');
  });

  it('passes a blank client key through to the doc scheme', () => {
    expect(deriveIdempotencyKey('u', 'p', 1, '   ')).toBe('doc:u:p:1');
  });

  it('throws on an over-long client key', () => {
    expect(() => deriveIdempotencyKey('u', 'p', 0, 'x'.repeat(257))).toThrow(/too long/);
  });
});

describe('retry nonce from terminal count', () => {
  it('is the count of prior terminal jobs', () => {
    expect(retryNonceFor(0)).toBe(0);
    expect(retryNonceFor(5)).toBe(5);
  });
});