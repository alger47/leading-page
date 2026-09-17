/**
 * Security header baseline (Phase 14 §12.4). Introspects next.config.mjs so a
 * regression in the hardening headers fails CI without needing a full render.
 */
import { describe, it, expect } from 'vitest';
import config from '../next.config.mjs';

const headerEntries = config.headers ? config.headers() : undefined;

async function headersFor(source: string): Promise<Array<{ key: string; value: string }>> {
  const rules = await headerEntries;
  const rule = (rules ?? []).find((r) => r.source === source);
  return rule?.headers ?? [];
}

describe('security headers', () => {
  it('applies hardening headers on every route', async () => {
    const headers = await headersFor('/(.*)');
    const keys = headers.map((h) => h.key);
    expect(keys).toContain('X-Content-Type-Options');
    expect(keys).toContain('X-Frame-Options');
    expect(keys).toContain('Referrer-Policy');
  });

  it('sends cross-origin isolation headers (COOP/CORP/OAC)', async () => {
    const headers = await headersFor('/(.*)');
    const map = new Map(headers.map((h) => [h.key, h.value]));
    expect(map.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(map.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
    expect(map.get('Origin-Agent-Cluster')).toBe('?1');
  });

  it('enforces TLS with HSTS (no preload commitment)', async () => {
    const headers = await headersFor('/(.*)');
    const map = new Map(headers.map((h) => [h.key, h.value]));
    const hsts = map.get('Strict-Transport-Security') ?? '';
    expect(hsts).toContain('max-age=');
    expect(hsts).toContain('includeSubDomains');
    expect(hsts).not.toContain('preload');
  });

  it('CSP locks down framing, base-uri and form-action', async () => {
    const headers = await headersFor('/(.*)');
    const csp = headers.find((h) => h.key === 'Content-Security-Policy')?.value ?? '';
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("default-src 'self'");
  });
});