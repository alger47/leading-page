/**
 * Safe-URL scheme policy (Phase 14 §12.3).
 */
import { describe, it, expect } from 'vitest';
import { isSafeHref, sanitizeHref } from '../src/schemes';

describe('isSafeHref', () => {
  it('accepts http(s), mailto, tel and fragment targets', () => {
    for (const href of [
      'https://example.com/page',
      'http://example.com',
      'mailto:hi@example.com',
      'tel:+33123456789',
      '#contact',
      '#',
    ]) {
      expect(isSafeHref(href)).toBe(true);
    }
  });

  it('accepts relative paths and internal asset refs', () => {
    for (const href of ['/pricing', 'features', './about', 'asset:hero-1']) {
      expect(isSafeHref(href)).toBe(true);
    }
  });

  it('rejects script-capable and data schemes', () => {
    for (const href of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
    ]) {
      expect(isSafeHref(href)).toBe(false);
    }
  });

  it('rejects whitespace/control-character smuggling attempts', () => {
    expect(isSafeHref('java\nscript:alert(1)')).toBe(false);
    expect(isSafeHref(' https://example.com')).toBe(false);
    expect(isSafeHref('https://example.com\n')).toBe(false);
    expect(isSafeHref('')).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isSafeHref(null as unknown as string)).toBe(false);
    expect(isSafeHref(undefined as unknown as string)).toBe(false);
  });
});

describe('sanitizeHref', () => {
  it('passes safe hrefs through untouched', () => {
    expect(sanitizeHref('https://example.com')).toBe('https://example.com');
    expect(sanitizeHref('#pricing')).toBe('#pricing');
  });

  it('collapses hostile hrefs to an inert local fragment', () => {
    expect(sanitizeHref('javascript:alert(1)')).toBe('#');
    expect(sanitizeHref('data:text/html,<script>x</script>')).toBe('#');
  });
});