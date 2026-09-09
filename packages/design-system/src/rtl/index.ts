/**
 * RTL Discipline utilities
 *
 * Per master prompt §5.4:
 * - Logical CSS properties only (lint-enforced in components)
 * - dir propagates from the schema (page.direction) — never guessed
 * - Arabic pages must look intentionally designed, not merely mirrored
 */

export type Direction = 'rtl' | 'ltr';

/**
 * Determine direction from locale code.
 */
export function directionFromLocale(locale: string): Direction {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

/**
 * Map physical → logical for the few cases a component needs a swap.
 * Components MUST prefer using CSS logical properties directly
 * (margin-inline-start, padding-inline, text-align: start, inset-inline).
 */
export function getLogicalStart(direction: Direction): string {
  return direction === 'rtl' ? 'right' : 'left';
}

export function getLogicalEnd(direction: Direction): string {
  return direction === 'rtl' ? 'left' : 'right';
}

/**
 * Visual QA matrix requirement (master prompt §5.4):
 * ar-RTL is a first-class lane, never a derived afterthought.
 */
export const QA_LANES = ['ar-rtl', 'fr-ltr', 'en-ltr'] as const;