/**
 * Unit tests for the version compare diff (Phase 9 — J4): metadata + section
 * diff summary semantics. Pure functions — no DB.
 */

import { describe, expect, it } from 'vitest';
import { diffVersions, deepEqual, type VersionDiffSummary } from '../lib/versions-diff';

interface FixtureSection {
  id: string;
  type: string;
  variant: string;
  content: Record<string, unknown>;
}

interface Fixture {
  schemaVersion: string;
  page: { title: string; locale: string; direction: string };
  theme: { preset: string; font: string; primaryColor: string; radius: string; density: string };
  sections: FixtureSection[];
}

const section = (id: string, type: string, variant: string, content: Record<string, unknown>): FixtureSection => ({ id, type, variant, content });

const v1: Fixture = {
  schemaVersion: '1.0.0',
  page: { title: 'Agence Bakhti', locale: 'fr', direction: 'ltr' },
  theme: { preset: 'warm-professional', font: 'inter', primaryColor: 'role:primary', radius: 'medium', density: 'comfortable' },
  sections: [
    section('header-01', 'header', 'basic', { navCta: { label: 'Contact', href: '#contact' } }),
    section('hero-01', 'hero', 'split', { title: 'Bienvenue', subtitle: 'Votre partenaire.', primaryCta: { label: 'Commander', href: '#order' } }),
    section('footer-01', 'footer', 'extended', { blurb: '© 2026' }),
  ],
};

function edited(): Fixture {
  return {
    ...v1,
    page: { ...v1.page, title: 'Agence Bakhti — nouvelle' },
    theme: { ...v1.theme, font: 'cairo', density: 'compact' },
    sections: [
      v1.sections[0],
      section('hero-01', 'hero', 'split', { ...v1.sections[1].content, title: 'Bienvenue chez nous' }),
      v1.sections[2],
    ],
  };
}

describe('versions diff — metadata', () => {
  it('reports unchanged metadata for identical envelopes', () => {
    const diff = diffVersions(v1, v1);
    expect(diff.metadata.title.changed).toBe(false);
    expect(diff.metadata.theme.changed).toBe(false);
    expect(diff.counts.unchanged).toBe(3);
    expect(diff.counts.changed).toBe(0);
  });

  it('detects title and theme changes', () => {
    const diff = diffVersions(v1, edited());
    expect(diff.metadata.title.changed).toBe(true);
    expect(diff.metadata.title.previous).toBe('Agence Bakhti');
    expect(diff.metadata.title.current).toBe('Agence Bakhti — nouvelle');
    expect(diff.metadata.locale.changed).toBe(false);
    expect(diff.metadata.direction.changed).toBe(false);
    expect(diff.metadata.theme.changed).toBe(true);
  });
});

describe('versions diff — sections', () => {
  const byId = (diff: VersionDiffSummary, id: string) => diff.sections.find((s) => s.id === id);

  it('marks a changed section with the differing slots', () => {
    const diff = diffVersions(v1, edited());
    const hero = byId(diff, 'hero-01');
    expect(hero?.action).toBe('changed');
    expect(hero?.changedSlots).toEqual(['content.title']);
    expect(diff.counts.changed).toBe(1);
    expect(diff.counts.unchanged).toBe(2);
  });

  it('flags added and removed sections by id', () => {
    const withoutHero = { ...v1, sections: v1.sections.filter((s) => s.id !== 'hero-01') };
    const withExtra = { ...v1, sections: [...v1.sections, { id: 'testimonials-01', type: 'features', variant: 'grid-3', content: { items: [] } }] };

    const removed = diffVersions(v1, withoutHero);
    expect(byId(removed, 'hero-01')?.action).toBe('removed');
    expect(byId(removed, 'hero-01')?.previousPosition).toBe(1);
    expect(removed.counts.removed).toBe(1);

    const added = diffVersions(v1, withExtra);
    expect(byId(added, 'testimonials-01')?.action).toBe('added');
    expect(byId(added, 'testimonials-01')?.currentPosition).toBe(3);
    expect(added.counts.added).toBe(1);
  });

  it('is symmetric for changed slots regardless of direction', () => {
    const a = diffVersions(v1, edited());
    const b = diffVersions(edited(), v1);
    const heroA = byId(a, 'hero-01');
    const heroB = byId(b, 'hero-01');
    expect(heroA?.action).toBe('changed');
    expect(heroB?.action).toBe('changed');
    expect(new Set(heroA?.changedSlots)).toEqual(new Set(heroB?.changedSlots));
  });
});

describe('versions diff — robustness', () => {
  it('handles non-envelope input without throwing (pathological versions)', () => {
    const diff = diffVersions(null, { sections: 'nope' });
    expect(diff.counts.unchanged).toBe(0);
    expect(diff.sections).toEqual([]);
    expect(diff.metadata.title.changed).toBe(false);
  });

  it('deepEqual is structural, not order-sensitive', () => {
    expect(deepEqual({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual([1, { x: true }], [1, { x: true }])).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
  });
});