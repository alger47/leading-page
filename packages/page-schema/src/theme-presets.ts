/**
 * Theme presets — the single source of truth for the editor's theme picker
 * (Phase 8 J3). Every entry maps 1:1 onto the envelope `Theme` object
 * (schema/envelope.schema.json §Theme), so switching preset never needs a
 * "custom" document: building a new version replaces the whole `theme`.
 *
 * IMPORTANT: `PRESET_NAMES` must stay in lockstep with the envelope schema's
 * `Theme.preset` enum. If one changes, the other MUST change with the same set.
 */

export type ThemePresetName = 'warm-professional' | 'cool-modern' | 'bold-creative' | 'minimal-clean';

export interface ThemePreset {
  preset: ThemePresetName;
  label: string;
  description: string;
  /** The exact envelope Theme values this preset produces (§Theme). */
  theme: {
    font: 'rubik' | 'cairo' | 'tajawal' | 'inter' | 'system';
    primaryColor: `role:${string}`;
    radius: 'none' | 'small' | 'medium' | 'large' | 'full';
    density: 'compact' | 'comfortable' | 'spacious';
  };
  /** Editor swatches (not part of the schema — UI only). */
  swatches: {
    primary: string;
    surface: string;
    text: string;
    muted: string;
  };
}

export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    preset: 'warm-professional',
    label: 'Warm Professional',
    description: 'Trustworthy and human-centered, for services, agencies, clinics.',
    theme: { font: 'rubik', primaryColor: 'role:primary', radius: 'small', density: 'comfortable' },
    swatches: { primary: '#b45309', surface: '#fffbeb', text: '#292524', muted: '#78716c' },
  },
  {
    preset: 'cool-modern',
    label: 'Cool Modern',
    description: 'Clean and technical, for SaaS and developer tools.',
    theme: { font: 'inter', primaryColor: 'role:primary', radius: 'medium', density: 'compact' },
    swatches: { primary: '#2563eb', surface: '#f8fafc', text: '#0f172a', muted: '#64748b' },
  },
  {
    preset: 'bold-creative',
    label: 'Bold Creative',
    description: 'High contrast and expressive, for brands, media, events.',
    theme: { font: 'inter', primaryColor: 'role:primary', radius: 'large', density: 'spacious' },
    swatches: { primary: '#e11d48', surface: '#fdf2f8', text: '#1e293b', muted: '#8b5cf6' },
  },
  {
    preset: 'minimal-clean',
    label: 'Minimal Clean',
    description: 'Quiet, spacious, editorial. For portfolios and personal pages.',
    theme: { font: 'system', primaryColor: 'role:primary', radius: 'none', density: 'spacious' },
    swatches: { primary: '#0a0a0a', surface: '#ffffff', text: '#111111', muted: '#737373' },
  },
];

export const THEME_PRESET_NAMES: readonly ThemePresetName[] = THEME_PRESETS.map((p) => p.preset);

export function getThemePreset(name: string): ThemePreset | undefined {
  return THEME_PRESETS.find((p) => p.preset === name);
}