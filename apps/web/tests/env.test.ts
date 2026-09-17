/**
 * Production env policy (Phase 15): Secure-cookie derivation + the single
 * cookie-flag helper used by session/CSRF set + clear paths.
 */
import { describe, it, expect } from 'vitest';
import { csrfCookieFlags, sessionCookieFlags } from '../lib/api';
import { webConfig } from '../lib/env';

describe('secureCookies derivation', () => {
  it('defaults to false outside production', () => {
    expect(webConfig({ NODE_ENV: 'development' }).secureCookies).toBe(false);
    expect(webConfig({ NODE_ENV: 'test' }).secureCookies).toBe(false);
    expect(webConfig({} as NodeJS.ProcessEnv).secureCookies).toBe(false);
  });

  it('defaults to true in production', () => {
    expect(webConfig({ NODE_ENV: 'production' }).secureCookies).toBe(true);
  });

  it('honours COOKIE_SECURE overrides in both directions', () => {
    expect(webConfig({ NODE_ENV: 'production', COOKIE_SECURE: '0' }).secureCookies).toBe(false);
    expect(webConfig({ NODE_ENV: 'development', COOKIE_SECURE: '1' }).secureCookies).toBe(true);
    expect(webConfig({ NODE_ENV: 'development', COOKIE_SECURE: 'true' }).secureCookies).toBe(true);
    expect(webConfig({ NODE_ENV: 'development', COOKIE_SECURE: 'false' }).secureCookies).toBe(false);
  });
});

describe('cookie flag helpers', () => {
  it('session cookies are HttpOnly + Strict + Path=/ and follow secure', () => {
    expect(sessionCookieFlags(true)).toEqual({ httpOnly: true, sameSite: 'strict', secure: true, path: '/' });
    expect(sessionCookieFlags(false).secure).toBe(false);
  });

  it('CSRF cookies are readable by JS (double-submit) but same-site and secure-aware', () => {
    expect(csrfCookieFlags(true)).toEqual({ httpOnly: false, sameSite: 'strict', secure: true, path: '/' });
    expect(csrfCookieFlags(false).httpOnly).toBe(false);
  });
});
