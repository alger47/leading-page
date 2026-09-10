/**
 * Theme preset single source of truth (Phase 8 J3): the preset set exported by
 * the package must match the envelope schema's Theme.preset enum exactly.
 */

import { describe, expect, it } from 'vitest';

import { THEME_PRESETS, THEME_PRESET_NAMES, getThemePreset } from '../src/theme-presets';

const ENVELOPE_THEME_PRESETS = ['warm-professional', 'cool-modern', 'bold-creative', 'minimal-clean'];

describe('theme presets', () => {
  it('ships exactly the envelope theme preset set', () => {
    expect([...THEME_PRESET_NAMES].sort()).toEqual([...ENVELOPE_THEME_PRESETS].sort());
  });

  it('ships valid theme settings for every preset', () => {
    for (const preset of THEME_PRESETS) {
      expect(preset.theme.primaryColor.startsWith('role:')).toBe(true);
      expect(['rubik', 'cairo', 'tajawal', 'inter', 'system']).toContain(preset.theme.font);
      expect(['none', 'small', 'medium', 'large', 'full']).toContain(preset.theme.radius);
      expect(['compact', 'comfortable', 'spacious']).toContain(preset.theme.density);
      expect(Object.keys(preset.swatches).sort()).toEqual(['muted', 'primary', 'surface', 'text']);
    }
  });

  it('resolves presets by name', () => {
    expect(getThemePreset('warm-professional')?.theme.font).toBe('rubik');
    expect(getThemePreset('nope')).toBeUndefined();
  });
});