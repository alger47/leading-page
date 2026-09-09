/**
 * Design system tests: themes + typography + RTL
 */

import { describe, it, expect } from 'vitest';
import { THEMES, getTheme, resolveTheme, warmProfessional, VALID_PRESETS } from '../src/themes';
import { getFontFamily, getFontStack, typeScale } from '../src/typography';
import { directionFromLocale, QA_LANES } from '../src/rtl';

describe('Themes', () => {
  it('ships the 4 required presets', () => {
    expect(VALID_PRESETS.sort()).toEqual(
      ['warm-professional', 'cool-modern', 'bold-creative', 'minimal-clean'].sort()
    );
  });

  it('every theme has all semantic color roles', () => {
    const required = [
      'primary', 'primaryHover', 'primarySoft', 'onPrimary', 'bg', 'surface',
      'surfaceAlt', 'text', 'textMuted', 'heading', 'borderColor', 'accent', 'onAccent',
    ];
    for (const t of Object.values(THEMES)) {
      for (const role of required) {
        expect(t.colors[role], `${t.preset}.${role}`).toBeDefined();
      }
    }
  });

  it('resolveTheme falls back to warm-professional for unknown presets', () => {
    expect(resolveTheme({ theme: { preset: 'bogus' } })).toBe(warmProfessional);
    expect(getTheme('bogus')).toBeUndefined();
  });

  it('resolveTheme returns the matched preset theme', () => {
    const t = resolveTheme({ theme: { preset: 'cool-modern' } } as unknown as Record<string, unknown>);
    expect(t.preset).toBe('cool-modern');
  });
});

describe('Typography', () => {
  it('arabic fonts get higher line-height, no letter-spacing', () => {
    const cairo = getFontStack('cairo');
    expect(cairo.lineHeightRatio).toBeGreaterThanOrEqual(1.6);
    expect(cairo.letterSpacing).toBe('0');
  });

  it('latin fonts get tighter leading than arabic fonts', () => {
    const inter = getFontStack('inter');
    const cairo = getFontStack('cairo');
    expect(inter.lineHeightRatio).toBeLessThan(cairo.lineHeightRatio);
    expect(inter.letterSpacing).not.toBe('0');
  });

  it('type scale is defined for all tiers', () => {
    expect(typeScale.display).toBe('3rem');
    expect(typeScale.h1).toBeTruthy();
    expect(typeScale.body).toBeTruthy();
  });
});

describe('RTL', () => {
  it('directionFromLocale maps ar→rtl, others→ltr', () => {
    expect(directionFromLocale('ar')).toBe('rtl');
    expect(directionFromLocale('fr')).toBe('ltr');
    expect(directionFromLocale('en')).toBe('ltr');
  });

  it('QA lanes include ar-rtl as first-class', () => {
    expect(QA_LANES).toContain('ar-rtl');
  });
});