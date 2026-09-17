/**
 * Safe-URL scheme policy (Phase 14 — security, §12.3).
 *
 * AI-generated and editor-supplied hrefs/urls are untrusted. This module is the
 * single enforcement point used by BOTH the L1 structural validator and the
 * renderer guard, so a `javascript:` / `data:` / `vbscript:` link can never
 * leave the schema and, if it somehow does, degrades to an inert `#` at render.
 */

const ALLOWED_SCHEMES = new Set(['http', 'https', 'mailto', 'tel', '#']);

/** Internal asset refs (`asset:` URLs) are app-generated, never user content. */
const INTERNAL_SCHEMES = new Set(['asset']);

const DANGEROUS_CHARS = /[\u0000-\u001f\u007f\s]/;

/**
 * True when `value` is a relative reference (no scheme) or uses an allowed
 * scheme. Whitespace/control characters are rejected outright (they can smuggle
 * scheme-vs-path confusion past a naive parser).
 */
export function isSafeHref(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (DANGEROUS_CHARS.test(value)) return false;

  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(value);
  if (!schemeMatch) return true; // relative path or bare fragment

  const scheme = schemeMatch[1].toLowerCase();
  return ALLOWED_SCHEMES.has(scheme) || INTERNAL_SCHEMES.has(scheme);
}

/**
 * Sanitize for render: allowed values pass through untouched, everything else
 * collapses to an inert local fragment so a hostile href can never become an
 * active link.
 */
export function sanitizeHref(value: string): string {
  return isSafeHref(value) ? value : '#';
}