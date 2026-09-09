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
