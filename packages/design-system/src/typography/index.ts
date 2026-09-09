/**
 * Typography — Arabic-first
 *
 * Per master prompt §5.3:
 * - Curated font sets with Arabic + Latin coverage
 * - Correct line-height & letter-spacing per script (Arabic needs more leading)
 * - font-display: swap
 * - Digit policy: Western digits by default (configurable)
 */

import { fontFamilySets, type FontFamilyName } from '../tokens';

export type Script = 'arabic' | 'latin';

export interface FontStack {
  arabic: string;
  latin: string;
  // Arabic requires more leading + no letter-spacing
  lineHeightRatio: number;
  letterSpacing: string;
}

/**
 * Get the font-family stack for a script.
 */
export function getFontFamily(font: FontFamilyName, script: Script): string {
  const set = fontFamilySets[font] ?? fontFamilySets.system;
  return set[script];
}

export function getFontStack(font: FontFamilyName): FontStack {
  const isArabicLike = font === 'cairo' || font === 'tajawal';
  return {
    arabic: getFontFamily(font, 'arabic'),
    latin: getFontFamily(font, 'latin'),
    lineHeightRatio: isArabicLike ? 1.8 : 1.6,
    letterSpacing: isArabicLike ? '0' : '-0.01em',
  };
}

/**
 * Heading line-heights per script.
 */
export const headingLineHeight = {
  arabic: 1.4,
  latin: 1.15,
} as const;

/**
 * Font size scale used by the renderer (rem-based).
 */
export const typeScale = {
  display: '3rem',      // 48px — hero headline
  h1: '2.25rem',        // 36px
  h2: '1.875rem',       // 30px
  h3: '1.5rem',         // 24px
  body: '1rem',         // 16px
  bodyLg: '1.125rem',   // 18px
  small: '0.875rem',    // 14px
  caption: '0.75rem',   // 12px
} as const;