/**
 * Worker config + fail-closed prod guard (Phase 14 §12.4).
 */
import { describe, it, expect } from 'vitest';
import { loadConfig, assertProdConfig, DEV_WORKER_TOKEN, DEV_ENGINE_TOKEN } from '../src/config';

describe('loadConfig', () => {
  it('falls back to dev defaults when env is empty', () => {
    const cfg = loadConfig({});
    expect(cfg.apiToken).toBe(DEV_WORKER_TOKEN);
    expect(cfg.engineToken).toBe(DEV_ENGINE_TOKEN);
  });
});

describe('assertProdConfig', () => {
  it('is a no-op when NODE_ENV is not production', () => {
    const cfg = loadConfig({});
    expect(() => assertProdConfig(cfg, { NODE_ENV: 'development' })).not.toThrow();
  });

  it('allows production when real tokens are present', () => {
    const cfg = loadConfig({
      NODE_ENV: 'production',
      WORKER_INTERNAL_TOKEN: 'real-token-at-least-32-bytes-long-long-enough',
      AI_INTERNAL_TOKEN: 'real-token-at-least-32-bytes-long-long-enough',
    });
    expect(() => assertProdConfig(cfg, { NODE_ENV: 'production' })).not.toThrow();
  });

  it('throws when WORKER_INTERNAL_TOKEN is still the dev default in production', () => {
    const cfg = loadConfig({ NODE_ENV: 'production' });
    expect(() => assertProdConfig(cfg, { NODE_ENV: 'production' })).toThrow(/WORKER_INTERNAL_TOKEN/);
  });

  it('throws when AI_INTERNAL_TOKEN is still the dev default in production', () => {
    const cfg = loadConfig({ NODE_ENV: 'production', WORKER_INTERNAL_TOKEN: 'real-token-at-least-32-bytes-long-long-enough' });
    expect(() => assertProdConfig(cfg, { NODE_ENV: 'production' })).toThrow(/AI_INTERNAL_TOKEN/);
  });

  it('reports both missing tokens at once', () => {
    const cfg = loadConfig({ NODE_ENV: 'production' });
    expect(() => assertProdConfig(cfg, { NODE_ENV: 'production' })).toThrow(/WORKER_INTERNAL_TOKEN, AI_INTERNAL_TOKEN/);
  });
});
