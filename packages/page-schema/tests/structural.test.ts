/**
 * L1 Structural Validation Tests
 * 
 * Tests for structural validation of Page Schema documents.
 * Per master prompt §4.11:
 * - Every valid fixture passes L1 + L2
 * - Every invalid fixture fails with its EXPECTED error code
 */

import { describe, it, expect } from 'vitest';
import { validateStructural, validateSectionIdUniqueness } from '../src/validators/structural';

// Valid fixtures
import validVetAr from '../examples/valid-vet-ar-001.json';
import validSaasEn from '../examples/valid-saas-en-001.json';

// AI-generated fixtures (Phase 5 — SchemaBuilder exports, engine drift-guarded)
import aiVetAr from '../examples/ai-vet-ar-001.json';
import aiSaasEn from '../examples/ai-saas-en-001.json';

// Invalid fixtures
import invalidNoHero from '../examples/invalid-no-hero.json';
import invalidDuplicateIds from '../examples/invalid-duplicate-ids.json';

describe('L1 Structural Validation', () => {
  describe('Valid fixtures', () => {
    it('should validate valid-vet-ar-001.json', () => {
      const result = validateStructural(validVetAr);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate valid-saas-en-001.json', () => {
      const result = validateStructural(validSaasEn);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate ai-vet-ar-001.json (SchemaBuilder output)', () => {
      const result = validateStructural(aiVetAr);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate ai-saas-en-001.json (SchemaBuilder output)', () => {
      const result = validateStructural(aiSaasEn);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Invalid fixtures', () => {
    it('should fail validation for missing required fields', () => {
      const invalidDoc = { page: {}, theme: {} };
      const result = validateStructural(invalidDoc);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should fail validation for invalid schemaVersion format', () => {
      const invalidDoc = {
        ...validVetAr,
        schemaVersion: 'invalid',
      };
      const result = validateStructural(invalidDoc);
      expect(result.valid).toBe(false);
    });
  });

  describe('Section-schema binding + registry checks (review هـ)', () => {
    const clone = (value: unknown) => structuredClone(value) as { sections: Array<{ id: string; type: string; variant: string; content: Record<string, unknown> }> };

    it('rejects content that violates its canonical section schema (E-VAL-STRUCT-005)', () => {
      const doc = clone(validVetAr);
      const hero = doc.sections.find((s) => s.type === 'hero')!;
      hero.content.description = 'not allowed by hero.schema.json'; // additionalProperties: false
      const result = validateStructural(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.ruleId === 'E-VAL-STRUCT-005' && e.path.includes('.content'))).toBe(true);
    });

    it('rejects a section type outside the registry (E-VAL-STRUCT-006)', () => {
      const doc = clone(validVetAr);
      doc.sections[1].type = 'services'; // registered in envelope, NOT in SECTION_REGISTRY
      const result = validateStructural(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.ruleId === 'E-VAL-STRUCT-006')).toBe(true);
    });

    it('rejects an unlisted type+variant combo (E-VAL-STRUCT-007)', () => {
      const doc = clone(validVetAr);
      const hero = doc.sections.find((s) => s.type === 'hero')!;
      hero.variant = 'left-align'; // not in registry hero variants
      const result = validateStructural(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.ruleId === 'E-VAL-STRUCT-007')).toBe(true);
    });

    it('rejects a missing required content slot (E-VAL-STRUCT-008)', () => {
      const doc = clone(validVetAr);
      delete doc.sections.find((s) => s.type === 'footer')!.content.brandName;
      const result = validateStructural(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.ruleId === 'E-VAL-STRUCT-008')).toBe(true);
    });
  });
});

describe('Section ID Uniqueness', () => {
  it('should pass for unique IDs', () => {
    const sections = [
      { id: 'hero-1' },
      { id: 'features-1' },
      { id: 'footer-1' },
    ];
    const errors = validateSectionIdUniqueness(sections);
    expect(errors).toHaveLength(0);
  });

  it('should fail for duplicate IDs', () => {
    const sections = [
      { id: 'hero-1' },
      { id: 'hero-1' },
      { id: 'footer-1' },
    ];
    const errors = validateSectionIdUniqueness(sections);
    expect(errors).toHaveLength(1);
    expect(errors[0].ruleId).toBe('E-VAL-STRUCT-002');
  });
});

describe('URL scheme validation (Phase 14 §12.3 — XSS gate)', () => {
  const clone = (value: unknown) => structuredClone(value) as Record<string, unknown>;

  it('still validates when every navigation target is allowed', () => {
    const doc = clone(validVetAr) as {
      sections: Array<{ id: string; content: { links?: Array<{ href: string }> } }>;
    };
    const footer = doc.sections.find((s) => s.id === 'footer-1') ?? doc.sections[0];
    const links = footer.content.links ?? (footer.content as { links: Array<{ href: string }> }).links;
    links[0].href = 'https://calendly.com/landing-ai';
    const result = validateStructural(doc);
    expect(result.valid).toBe(true);
  });

  it('fails with E-VAL-STRUCT-004 for a javascript: href in section content', () => {
    const doc = clone(validVetAr) as {
      sections: Array<{ id: string; content: { links?: Array<{ href: string }> } }>;
    };
    const footer = doc.sections.find((s) => s.id === 'footer-1') ?? doc.sections[0];
    const links = footer.content.links ?? (footer.content as { links: Array<{ href: string }> }).links;
    links[0].href = 'javascript:alert(document.cookie)';
    const result = validateStructural(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.ruleId === 'E-VAL-STRUCT-004' && e.path.includes('.href'))).toBe(true);
  });

  it('fails for a data: scheme in an asset url', () => {
    const doc = clone(validSaasEn) as { assets?: Array<{ id: string; kind: string; source: string; url: string; alt: string }> };
    doc.assets = [{ id: 'asset:hero-main', kind: 'image', source: 'curated', url: 'data:text/html;base64,PHNjcmlwdD4=', alt: 'hero image' }];
    const result = validateStructural(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.ruleId === 'E-VAL-STRUCT-004' && e.path === '$.assets[0].url')).toBe(true);
  });

  it('allows internal anchor and scheme-relative links that fixtures use', () => {
    const doc = clone(validVetAr) as {
      sections: Array<{ id: string; content: { links?: Array<{ href: string }> } }>;
    };
    const footer = doc.sections.find((s) => s.id === 'footer-1') ?? doc.sections[0];
    const links = footer.content.links ?? (footer.content as { links: Array<{ href: string }> }).links;
    for (const href of ['#services', '#cta', 'mailto:support@vet-ar.io', '/careers']) {
      const attempt = clone(doc) as typeof doc;
      const target = attempt.sections.find((s) => s.id === 'footer-1') ?? attempt.sections[0];
      const attemptLinks = target.content.links ?? (target.content as { links: Array<{ href: string }> }).links;
      attemptLinks[0].href = href;
      const result = validateStructural(attempt);
      expect(result.valid).toBe(true);
    }
  });
});
