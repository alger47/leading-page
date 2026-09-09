/**
 * L1 Structural Validation
 * 
 * Validates the Page Schema against the JSON Schema definition.
 * This is the first validation layer - it checks structural correctness.
 * 
 * Per master prompt §8.1:
 * - L1 errors block render
 * - Structural validity NEVER implies semantic quality
 */

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import envelopeSchema from '../../schema/envelope.schema.json';

export interface ValidationError {
  layer: 'structural';
  ruleId: string;
  severity: 'error';
  path: string;
  message: string;
  fixable: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

const ajv = new Ajv({ allErrors: true, verbose: true });
addFormats(ajv);

const validateSchema = ajv.compile(envelopeSchema);

/**
 * Validate a Page Schema document against the JSON Schema.
 * 
 * @param document - The Page Schema document to validate
 * @returns ValidationResult with valid flag and any errors
 */
export function validateStructural(document: unknown): ValidationResult {
  const valid = validateSchema(document) as boolean;
  
  if (valid) {
    return { valid: true, errors: [] };
  }

  const errors: ValidationError[] = (validateSchema.errors || []).map((err) => ({
    layer: 'structural' as const,
    ruleId: 'E-VAL-STRUCT-001',
    severity: 'error' as const,
    path: err.instancePath || '/',
    message: err.message || 'Structural validation error',
    fixable: false,
  }));

  return { valid: false, errors };
}

/**
 * Validate section ID uniqueness.
 * 
 * @param sections - Array of sections to check
 * @returns Array of validation errors for duplicate IDs
 */
export function validateSectionIdUniqueness(
  sections: Array<{ id: string }>
): ValidationError[] {
  const seen = new Set<string>();
  const errors: ValidationError[] = [];

  for (const section of sections) {
    if (seen.has(section.id)) {
      errors.push({
        layer: 'structural',
        ruleId: 'E-VAL-STRUCT-002',
        severity: 'error',
        path: `$.sections[?(@.id=="${section.id}")]`,
        message: `Duplicate section ID: "${section.id}"`,
        fixable: true,
      });
    }
    seen.add(section.id);
  }

  return errors;
}

/**
 * Validate asset references in sections.
 * 
 * @param sections - Array of sections with asset references
 * @param assets - Array of available assets
 * @returns Array of validation errors for missing assets
 */
export function validateAssetReferences(
  sections: Array<{ content: Record<string, unknown> }>,
  assets: Array<{ id: string }>
): ValidationError[] {
  const assetIds = new Set(assets.map((a) => a.id));
  const errors: ValidationError[] = [];

  // Simple recursive search for assetRef in content
  function findAssetRefs(obj: unknown, path: string): void {
    if (obj === null || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      obj.forEach((item, index) => findAssetRefs(item, `${path}[${index}]`));
      return;
    }

    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const currentPath = `${path}.${key}`;
      
      if (key === 'assetRef' && typeof value === 'string') {
        if (!assetIds.has(value)) {
          errors.push({
            layer: 'structural',
            ruleId: 'E-VAL-STRUCT-003',
            severity: 'error',
            path: currentPath,
            message: `Asset reference not found: "${value}"`,
            fixable: false,
          });
        }
      }
      
      findAssetRefs(value, currentPath);
    }
  }

  sections.forEach((section, index) => {
    findAssetRefs(section.content, `$.sections[${index}].content`);
  });

  return errors;
}
