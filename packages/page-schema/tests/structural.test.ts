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
    const doc = clone(validVetAr);
    const cta = (doc.sections as Array<{ id: string; content: { href?: string } }>).find((s) => s.id === 'cta-1') ??
      (doc.sections as Array<{ id: string; content: { href?: string } }>)[0];
    cta.content.href = 'https://calendly.com/landing-ai';
    const result = validateStructural(doc);
    expect(result.valid).toBe(true);
  });

  it('fails with E-VAL-STRUCT-004 for a javascript: href in section content', () => {
    const doc = clone(validVetAr) as { sections: Array<{ id: string; content: Record<string, unknown> }> };
    (doc.sections[0].content as { href?: string }).href = 'javascript:alert(document.cookie)';
    const result = validateStructural(doc);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].ruleId).toBe('E-VAL-STRUCT-004');
    expect(result.errors[0].path).toContain('.href');
  });

  it('fails for a data: scheme in an asset url', () => {
    const doc = clone(validSaasEn) as { assets?: Array<{ id: string; kind: string; source: string; url: string; alt: string }> };
    doc.assets = [{ id: 'asset:hero-main', kind: 'image', source: 'curated', url: 'data:text/html;base64,PHNjcmlwdD4=', alt: 'hero image' }];
    const result = validateStructural(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.ruleId === 'E-VAL-STRUCT-004' && e.path === '$.assets[0].url')).toBe(true);
  });

  it('allows internal anchor and scheme-relative links that fixtures use', () => {
    const doc = clone(validVetAr);
    for (const href of ['#services', '#cta', 'mailto:support@vet-ar.io', '/careers']) {
      const attempt = clone(doc) as { sections: Array<{ id: string; content: Record<string, unknown> }> };
      (attempt.sections[0].content as { href?: string }).href = href;
      const result = validateStructural(attempt);
      expect(result.valid).toBe(true);
    }
  });
});
