/**
 * Fail-closed production guards (Phase 14 §12.4).
 */
import { describe, it, expect } from 'vitest';
import { GenerationService } from '../lib/generation-service';
import { webConfig, DEV_WORKER_TOKEN } from '../lib/env';
import { FakeWorkerClient } from './harness';

describe('GenerationService production guard', () => {
  it('refuses to reach the worker with the dev-default token in production', () => {
    const cfg = { ...webConfig(process.env), isProd: true, workerToken: DEV_WORKER_TOKEN };
    expect(() => new GenerationService({}, cfg)).toThrow(/WORKER_INTERNAL_TOKEN is unset/);
  });

  it('allows construction when a real token is configured in production', () => {
    const cfg = { ...webConfig(process.env), isProd: true, workerToken: 'real-token-at-least-32-bytes-long-long-enough' };
    const service = new GenerationService({ worker: new FakeWorkerClient() }, cfg);
    expect(service).toBeInstanceOf(GenerationService);
  });

  it('allows dev defaults outside production', () => {
    const cfg = { ...webConfig(process.env), isProd: false, workerToken: DEV_WORKER_TOKEN };
    const service = new GenerationService({ worker: new FakeWorkerClient() }, cfg);
    expect(service).toBeInstanceOf(GenerationService);
  });
});