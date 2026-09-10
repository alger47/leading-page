'use client';

/**
 * Placeholder completion panel (Phase 13). The engine never hallucinates: when
 * the brief lacks a business name / phone / email / address it emits explicit
 * `[...]` tokens (stub_data GENERIC). This panel walks the whole draft, finds
 * every such token and offers one input per field to fill them all in place.
 */

import { useMemo } from 'react';
import { sectionTypeLabel, type Path } from './editor-utils';

export interface PlaceholdersPanelProps {
  content: Record<string, unknown>;
  onUpdate(path: Path, value: unknown): void;
}

export interface PlaceholderField {
  path: Path;
  label: string;
  value: string;
}

export interface PlaceholderGroup {
  sectionLabel: string;
  sectionId: string;
  fields: PlaceholderField[];
}

const PLACEHOLDER_RE = /\[[^[\]]+\]/;

const FIELD_LABELS: Record<string, string> = {
  brandName: 'Brand / business name',
  phone: 'Phone',
  email: 'Email',
  address: 'Address',
  name: 'Name',
  title: 'Title',
  subtitle: 'Subtitle',
  tagline: 'Tagline',
  hero_title: 'Hero title',
  description: 'Description',
  legal: 'Legal text',
  footnote: 'Footnote',
  primaryCta: 'Primary CTA',
  primary_cta_label: 'Primary CTA',
  cta: 'Call to action',
  ctaLabel: 'Call to action',
  secondaryCta: 'Secondary CTA',
};

function humanize(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  const words = key.replace(/[_.-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

function collectFields(node: unknown, path: Path, out: PlaceholderField[]): void {
  if (typeof node === 'string') {
    if (PLACEHOLDER_RE.test(node)) {
      const last = path[path.length - 1];
      out.push({ path: path as Path, label: humanize(String(last)), value: node });
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) => collectFields(item, [...path, index] as Path, out));
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      collectFields(value, [...path, key] as Path, out);
    }
  }
}

export function collectPlaceholderGroups(content: Record<string, unknown>): PlaceholderGroup[] {
  const groups: PlaceholderGroup[] = [];
  const sections = Array.isArray(content.sections) ? (content.sections as Array<Record<string, unknown>>) : [];
  sections.forEach((section, index) => {
    const fields: PlaceholderField[] = [];
    collectFields(section.content, ['sections', index, 'content'], fields);
    if (fields.length === 0) return;
    groups.push({
      sectionLabel: sectionTypeLabel(section.type),
      sectionId: String(section.id ?? index),
      fields,
    });
  });

  // Top-level fields (e.g. a page title fallback) not owned by a section.
  const topFields: PlaceholderField[] = [];
  for (const [key, value] of Object.entries(content)) {
    if (key === 'sections') continue;
    collectFields(value, [key], topFields);
  }
  if (topFields.length > 0) groups.push({ sectionLabel: 'Page', sectionId: 'page', fields: topFields });
  return groups;
}

export function PlaceholdersPanel({ content, onUpdate }: PlaceholdersPanelProps) {
  const groups = useMemo(() => collectPlaceholderGroups(content), [content]);

  if (groups.length === 0) {
    return (
      <div className="panel placeholders placeholders--empty">
        <h2 className="panel-title">Compléter les informations</h2>
        <p className="editor-note">No placeholders to fill.</p>
      </div>
    );
  }

  return (
    <div className="panel placeholders">
      <h2 className="panel-title">Compléter les informations</h2>
      {groups.map((group) => (
        <fieldset key={group.sectionId} className="ph-group">
          <legend>
            {group.sectionLabel} <span className="ph-section-id">{group.sectionId}</span>
          </legend>
          {group.fields.map((field, i) => (
            <label key={i} className="ph-field">
              <span className="ph-label">{field.label}</span>
              <input
                defaultValue={field.value}
                placeholder={field.value}
                aria-label={`${group.sectionLabel} — ${field.label}`}
                onChange={(e) => onUpdate(field.path, e.target.value)}
              />
            </label>
          ))}
        </fieldset>
      ))}
      <style jsx>{`
        .placeholders { display: grid; gap: 10px; }
        .ph-group { border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 8px 10px 10px; margin: 0; display: grid; gap: 8px; }
        .ph-group legend { font-size: 0.75rem; font-weight: 600; padding: 0 4px; }
        .ph-section-id { font-family: ui-monospace, monospace; color: var(--color-text-muted); font-weight: 400; }
        .ph-field { display: grid; gap: 3px; }
        .ph-label { font-size: 0.75rem; color: var(--color-text-muted); }
        .ph-field input { padding: 6px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); font-size: 0.8125rem; }
      `}</style>
    </div>
  );
}