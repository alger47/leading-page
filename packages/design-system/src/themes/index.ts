/**
 * Theme Presets
 *
 * Themes are validated data, not CSS (master prompt §5.2).
 * Every field is a constrained enum/reference — no free-form CSS values.
 * Themes remap the semantic color roles using primitive tokens only.
 */

import { colorPrimitives, type ColorRole } from '../tokens';

export interface Theme {
  preset: string;
  font: 'rubik' | 'cairo' | 'tajawal' | 'inter' | 'system';
  primaryColor: 'role:primary' | 'role:accent';
  radius: 'none' | 'small' | 'medium' | 'large' | 'full';
  density: 'compact' | 'comfortable' | 'spacious';
  colors: Record<ColorRole, string>;
}

export type DensityFactor = Record<'compact' | 'comfortable' | 'spacious', number>;

/**
 * Density multipliers applied to base spacing.
 */
export const densityFactor: DensityFactor = {
  compact: 0.75,
  comfortable: 1,
  spacious: 1.25,
};

function buildTheme(
  preset: string,
  font: Theme['font'],
  radius: Theme['radius'],
  density: Theme['density'],
  colors: Record<ColorRole, string>
): Theme {
  return { preset, font, primaryColor: 'role:primary' as const, radius, density, colors };
}

// ─── Theme: warm-professional ──────────────────────────────────────
// Warm, trustworthy palette suited to clinics, restaurants, law firms.
export const warmProfessional: Theme = buildTheme(
  'warm-professional',
  'rubik',
  'medium',
  'comfortable',
  {
    primary: colorPrimitives.amber600,
    primaryHover: colorPrimitives.amber700,
    primarySoft: colorPrimitives.amber50,
    onPrimary: colorPrimitives.white,
    bg: colorPrimitives.neutral50,
    surface: colorPrimitives.white,
    surfaceAlt: colorPrimitives.amber50,
    text: colorPrimitives.neutral600,
    textMuted: colorPrimitives.neutral500,
    heading: colorPrimitives.neutral900,
    borderColor: colorPrimitives.neutral200,
    accent: colorPrimitives.amber500,
    onAccent: colorPrimitives.white,
  }
);

// ─── Theme: cool-modern ────────────────────────────────────────────
// Clean, tech-forward cool palette suited to SaaS, startups.
export const coolModern: Theme = buildTheme(
  'cool-modern',
  'inter',
  'small',
  'comfortable',
  {
    primary: colorPrimitives.blue600,
    primaryHover: colorPrimitives.blue700,
    primarySoft: colorPrimitives.blue50,
    onPrimary: colorPrimitives.white,
    bg: colorPrimitives.white,
    surface: colorPrimitives.neutral50,
    surfaceAlt: colorPrimitives.blue50,
    text: colorPrimitives.neutral600,
    textMuted: colorPrimitives.neutral500,
    heading: colorPrimitives.neutral900,
    borderColor: colorPrimitives.neutral200,
    accent: colorPrimitives.blue500,
    onAccent: colorPrimitives.white,
  }
);

// ─── Theme: bold-creative ──────────────────────────────────────────
// Vibrant, high-energy palette suited to agencies, gyms, creative brands.
export const boldCreative: Theme = buildTheme(
  'bold-creative',
  'tajawal',
  'large',
  'comfortable',
  {
    primary: colorPrimitives.violet600,
    primaryHover: colorPrimitives.violet500,
    primarySoft: colorPrimitives.violet50,
    onPrimary: colorPrimitives.white,
    bg: colorPrimitives.neutral900,
    surface: colorPrimitives.neutral800,
    surfaceAlt: colorPrimitives.neutral700,
    text: colorPrimitives.neutral300,
    textMuted: colorPrimitives.neutral400,
    heading: colorPrimitives.white,
    borderColor: colorPrimitives.neutral700,
    accent: colorPrimitives.teal500,
    onAccent: colorPrimitives.white,
  }
);

// ─── Theme: minimal-clean ──────────────────────────────────────────
// Understated, content-focused palette suited to services, education.
export const minimalClean: Theme = buildTheme(
  'minimal-clean',
  'system',
  'none',
  'comfortable',
  {
    primary: colorPrimitives.neutral900,
    primaryHover: colorPrimitives.neutral800,
    primarySoft: colorPrimitives.neutral100,
    onPrimary: colorPrimitives.white,
    bg: colorPrimitives.white,
    surface: colorPrimitives.neutral50,
    surfaceAlt: colorPrimitives.neutral100,
    text: colorPrimitives.neutral600,
    textMuted: colorPrimitives.neutral500,
    heading: colorPrimitives.neutral900,
    borderColor: colorPrimitives.neutral200,
    accent: colorPrimitives.blue600,
    onAccent: colorPrimitives.white,
  }
);

export const THEMES: Record<string, Theme> = {
  'warm-professional': warmProfessional,
  'cool-modern': coolModern,
  'bold-creative': boldCreative,
  'minimal-clean': minimalClean,
};

export const VALID_PRESETS = Object.keys(THEMES);

export function getTheme(preset: string): Theme | undefined {
  return THEMES[preset];
}

/**
 * Resolve a theme from a Page Schema theme object.
 * Falls back to warm-professional if unknown or missing.
 * NEVER invents a theme at runtime.
 */
export function resolveTheme(
  schema: Record<string, unknown>
): Theme {
  const t = schema?.theme as Partial<Theme> | undefined;
  const preset = t?.preset;
  if (preset && THEMES[preset]) {
    return THEMES[preset];
  }
  return warmProfessional;
}