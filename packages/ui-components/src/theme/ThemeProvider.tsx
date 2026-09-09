/**
 * ThemeProvider
 *
 * Injects resolved theme tokens as CSS custom properties.
 * The renderer resolves the theme from the schema (never invents one).
 * Direction (dir) also propagates from the schema here.
 */

import React from 'react';
import type { Theme } from '@landing-ai/design-system';
import { getFontStack, getFontFamily, typeScale, space, radius as radiusTokens } from '@landing-ai/design-system';
import type { Direction } from '@landing-ai/design-system';

export interface ThemeContextValue {
  theme: Theme;
  direction: Direction;
  locale: string;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}

export interface ThemeProviderProps {
  theme: Theme;
  locale: string;
  direction: Direction;
  children: React.ReactNode;
}

export function ThemeProvider({ theme, locale, direction, children }: ThemeProviderProps) {
  const script = locale === 'ar' ? 'arabic' : 'latin';
  const stack = getFontStack(theme.font);
  const fontFamily = getFontFamily(theme.font, script);

  const cssVars = {
    '--color-primary': theme.colors.primary,
    '--color-primary-hover': theme.colors.primaryHover,
    '--color-primary-soft': theme.colors.primarySoft,
    '--color-on-primary': theme.colors.onPrimary,
    '--color-bg': theme.colors.bg,
    '--color-surface': theme.colors.surface,
    '--color-surface-alt': theme.colors.surfaceAlt,
    '--color-text': theme.colors.text,
    '--color-text-muted': theme.colors.textMuted,
    '--color-heading': theme.colors.heading,
    '--color-border': theme.colors.borderColor,
    '--color-accent': theme.colors.accent,
    '--color-on-accent': theme.colors.onAccent,
    '--font-family': fontFamily,
    '--font-latin': stack.latin,
    '--font-arabic': stack.arabic,
    '--line-height': String(stack.lineHeightRatio),
    '--letter-spacing': stack.letterSpacing,
    '--radius': radiusTokens[theme.radius],
    '--space-1': space[1],
    '--space-2': space[2],
    '--space-3': space[3],
    '--space-4': space[4],
    '--space-6': space[6],
    '--space-8': space[8],
    '--space-12': space[12],
    '--space-16': space[16],
    '--type-display': typeScale.display,
    '--type-h1': typeScale.h1,
    '--type-h2': typeScale.h2,
    '--type-h3': typeScale.h3,
    '--type-body': typeScale.body,
    '--type-body-lg': typeScale.bodyLg,
    '--type-small': typeScale.small,
  } as React.CSSProperties;

  return (
    <ThemeContext.Provider value={{ theme, direction, locale }}>
      <div dir={direction} lang={locale} style={cssVars}>
        {children}
      </div>
    </ThemeContext.Provider>
  );
}