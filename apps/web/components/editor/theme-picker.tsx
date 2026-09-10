'use client';

/**
 * Theme picker: applies a design-system theme preset to the draft's `theme`
 * object (envelope Theme requires preset/font/primaryColor/radius/density).
 */

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/client-api';

export interface ThemePresetView {
  preset: string;
  label: string;
  description?: string;
  theme: { font: string; primaryColor: string; radius: string; density: string };
  swatches: string[];
}

export interface ThemePickerProps {
  current: { preset?: string } | undefined;
  onApply(preset: ThemePresetView): void;
}

export function ThemePicker({ current, onApply }: ThemePickerProps) {
  const [themes, setThemes] = useState<ThemePresetView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await apiFetch<{ themes?: ThemePresetView[]; error?: { message?: string } }>('/api/v1/themes');
      if (!alive) return;
      if (res.status === 200 && res.body.themes) setThemes(res.body.themes);
      else setError(res.body?.error?.message ?? 'Could not load themes.');
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <p className="editor-note">{error}</p>;
  if (themes === null) return <p className="editor-note">Loading themes…</p>;

  return (
    <div className="theme-grid">
      {themes.map((theme) => {
        const active = current?.preset === theme.preset;
        return (
          <button
            type="button"
            key={theme.preset}
            className={`theme-cell${active ? ' active' : ''}`}
            onClick={() => onApply(theme)}
            aria-pressed={active}
          >
            <span className="swatches" aria-hidden="true">
              {theme.swatches.slice(0, 3).map((c) => (
                <i key={c} style={{ backgroundColor: c }} />
              ))}
            </span>
            <span className="theme-label">{theme.label}</span>
          </button>
        );
      })}
      <style jsx>{`
        .theme-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
        .theme-cell { text-align: start; padding: 8px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface); cursor: pointer; display: grid; gap: 6px; }
        .theme-cell.active { border-color: var(--color-primary); box-shadow: 0 0 0 1px var(--color-primary) inset; }
        .swatches { display: flex; gap: 4px; }
        .swatches i { width: 18px; height: 18px; border-radius: 9999px; border: 1px solid rgba(0, 0, 0, 0.08); }
        .theme-label { font-size: 0.75rem; color: var(--color-text); }
      `}</style>
    </div>
  );
}