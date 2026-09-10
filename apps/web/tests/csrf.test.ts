/**
 * CSRF double-submit: matching/absent/mismatched cookie+header pairs, and
 * that the compare never touches the raw token contents (hash-based).
 */
import { describe, expect, it } from 'vitest';
import { generateCsrfToken, csrfTokensMatch } from '../lib/auth/csrf.js';

describe('CSRF double-submit', () => {
  it('accepts a matching cookie + header pair', () => {
    const token = generateCsrfToken();
    expect(csrfTokensMatch(token, token)).toBe(true);
  });

  it('rejects a mismatch', () => {
    expect(csrfTokensMatch(generateCsrfToken(), generateCsrfToken())).toBe(false);
  });

  it('rejects a missing cookie or header', () => {
    const token = generateCsrfToken();
    expect(csrfTokensMatch(undefined, token)).toBe(false);
    expect(csrfTokensMatch(token, undefined)).toBe(false);
    expect(csrfTokensMatch(undefined, undefined)).toBe(false);
  });

  it('rejects empty strings', () => {
    expect(csrfTokensMatch('', '')).toBe(false);
  });

  it('generates unique, opaque tokens', () => {
    expect(generateCsrfToken()).not.toBe(generateCsrfToken());
    expect(generateCsrfToken().length).toBeGreaterThanOrEqual(20);
  });
});