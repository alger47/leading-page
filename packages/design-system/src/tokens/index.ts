/**
 * Design Tokens
 *
 * Primitive → semantic → component aliasing model (DTCG-inspired).
 * Per master prompt §5.1:
 * - Groups: color, font, space, radius, shadow, size, breakpoint, motion, z-index
 * - Themes remap semantic tokens only
 * - Components consume semantic/component tokens only — never raw primitives
 */

// ─── Color Primitives ──────────────────────────────────────────────
export const colorPrimitives = {
  // Brand scale
  blue50: '#eff6ff',
  blue100: '#dbeafe',
  blue500: '#3b82f6',
  blue600: '#2563eb',
  blue700: '#1d4ed8',

  // Warm scale
  amber50: '#fffbeb',
  amber100: '#fef3c7',
  amber500: '#f59e0b',
  amber600: '#d97706',
  amber700: '#b45309',

  // Teal scale
  teal50: '#f0fdfa',
  teal500: '#14b8a6',
  teal600: '#0d9488',
  teal700: '#0f766e',

  // Violet scale
  violet50: '#f5f3ff',
  violet500: '#8b5cf6',
  violet600: '#7c3aed',

  // Neutral scale
  neutral50: '#fafafa',
  neutral100: '#f4f4f5',
  neutral200: '#e4e4e7',
  neutral300: '#d4d4d8',
  neutral400: '#a1a1aa',
  neutral500: '#71717a',
  neutral600: '#52525b',
  neutral700: '#3f3f46',
  neutral800: '#27272a',
  neutral900: '#18181b',

  // Semantic fixed
  white: '#ffffff',
  black: '#000000',
} as const;

// ─── Color Semantic Roles ──────────────────────────────────────────
export type ColorRole =
  | 'primary'
  | 'primaryHover'
  | 'primarySoft'
  | 'onPrimary'
  | 'bg'
  | 'surface'
  | 'surfaceAlt'
  | 'text'
  | 'textMuted'
  | 'heading'
  | 'borderColor'
  | 'accent'
  | 'onAccent';

export type ThemePresetName =
  | 'warm-professional'
  | 'cool-modern'
  | 'bold-creative'
  | 'minimal-clean';

// ─── Font Tokens ───────────────────────────────────────────────────
export const fontFamilySets = {
  rubik: {
    arabic: "'Rubik', 'Segoe UI', system-ui, sans-serif",
    latin: "'Rubik', 'Inter', system-ui, sans-serif",
  },
  cairo: {
    arabic: "'Cairo', 'Segoe UI', system-ui, sans-serif",
    latin: "'Cairo', 'Inter', system-ui, sans-serif",
  },
  tajawal: {
    arabic: "'Tajawal', 'Segoe UI', system-ui, sans-serif",
    latin: "'Tajawal', 'Inter', system-ui, sans-serif",
  },
  inter: {
    arabic: "'Inter', 'Tajawal', 'Segoe UI', system-ui, sans-serif",
    latin: "'Inter', system-ui, sans-serif",
  },
  system: {
    arabic: "system-ui, -apple-system, 'Segoe UI', sans-serif",
    latin: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
} as const;

export type FontFamilyName = keyof typeof fontFamilySets;

export const fontSizes = {
  'text-xs': '0.75rem',
  'text-sm': '0.875rem',
  'text-base': '1rem',
  'text-lg': '1.125rem',
  'text-xl': '1.25rem',
  'text-2xl': '1.5rem',
  'text-3xl': '1.875rem',
  'text-4xl': '2.25rem',
  'text-5xl': '3rem',
  'text-6xl': '3.75rem',
} as const;

export const fontWeights = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

// ─── Space Tokens ──────────────────────────────────────────────────
export const space = {
  0: '0',
  1: '0.25rem',
  2: '0.5rem',
  3: '0.75rem',
  4: '1rem',
  5: '1.25rem',
  6: '1.5rem',
  8: '2rem',
  10: '2.5rem',
  12: '3rem',
  16: '4rem',
  20: '5rem',
  24: '6rem',
} as const;

// ─── Radius Tokens ─────────────────────────────────────────────────
export const radius = {
  none: '0',
  small: '0.25rem',
  medium: '0.5rem',
  large: '0.75rem',
  full: '9999px',
} as const;

// ─── Shadow Tokens ─────────────────────────────────────────────────
export const shadow = {
  none: 'none',
  sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
  md: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
  lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
} as const;

// ─── Breakpoints ───────────────────────────────────────────────────
export const breakpoints = {
  mobile: '375px',
  tablet: '768px',
  desktop: '1280px',
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
} as const;

// ─── Motion ────────────────────────────────────────────────────────
export const motion = {
  durationFast: '120ms',
  durationNormal: '200ms',
  durationSlow: '300ms',
  easeDefault: 'cubic-bezier(0.4, 0, 0.2, 1)',
  easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
  easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
} as const;

// ─── Z-Index ───────────────────────────────────────────────────────
export const zIndex = {
  base: '0',
  sticky: '10',
  dropdown: '20',
  modal: '30',
  toast: '40',
} as const;

// ─── Containers ────────────────────────────────────────────────────
export const containerWidth = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
} as const;