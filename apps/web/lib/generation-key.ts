/**
 * Generation id/idempotency-key scheme.
 *
 * The web computes the same deterministic job id the worker derives from the
 * idempotency key (`gen_<sha256(key)[0:24]>`, apps/worker/src/jobs/enqueue.ts),
 * so the database GenerationJob row and the in-flight worker record are the
 * SAME job. A client-supplied Idempotency-Key is honored verbatim (§11.1);
 * otherwise the key is derived per (user, page) with a retry nonce so a fresh
 * attempt after a terminal failure is a new job — deterministically.
 */

import { createHash } from 'node:crypto';

export function jobIdForIdempotencyKey(idempotencyKey: string): string {
  return `gen_${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 24)}`;
}

export function deriveIdempotencyKey(userId: string, pageId: string, retryNonce: number, clientKey?: string): string {
  if (clientKey !== undefined && clientKey.trim() !== '') {
    const key = clientKey.trim();
    if (key.length > 256) throw new Error('idempotency key too long');
    return key;
  }
  return `doc:${userId}:${pageId}:${retryNonce}`;
}

/** Retry nonce = count of prior terminal (failed/cancelled) jobs on this page. */
export function retryNonceFor(priorTerminalCount: number): number {
  return priorTerminalCount;
}