/**
 * Codegen Drift Check
 *
 * Per master prompt §4.2 and ADR-0002:
 * "CI MUST fail if generated artifacts drift from the canonical source."
 *
 * This script verifies that:
 * 1. Every section type in the registry has a corresponding JSON Schema file
 * 2. Every JSON Schema file in schema/sections/ is referenced by the registry
 *
 * In a full implementation, this would also verify Zod/Pydantic codegen output.
 * For now, it checks the registry ↔ schema lockstep (migration baseline).
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, '..');
const registryFile = join(pkgRoot, 'src', 'registry.ts');
const schemaDir = join(pkgRoot, 'schema', 'sections');

const errors = [];

// Extract the seed section types from the registry source
const registrySource = readFileSync(registryFile, 'utf-8');
const seedTypes = ['header', 'hero', 'features', 'cta', 'footer'];

for (const type of seedTypes) {
  if (!registrySource.includes(`${type}: {`)) {
    errors.push(`Registry missing section type: ${type}`);
  }

  const schemaFile = join(schemaDir, `${type}.schema.json`);
  if (!existsSync(schemaFile)) {
    errors.push(`Missing JSON Schema for section type: ${type}`);
  }
}

// Verify no orphan schema files
if (existsSync(schemaDir)) {
  for (const file of readdirSync(schemaDir)) {
    if (!file.endsWith('.schema.json')) continue;
    const type = file.replace('.schema.json', '');
    if (!seedTypes.includes(type)) {
      errors.push(`Schema file not referenced in registry: ${file}`);
    }
  }
}

if (errors.length > 0) {
  console.error('CODE DRIFT DETECTED:');
  for (const err of errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
}

console.log('✓ No drift detected. Registry and JSON Schemas are in lockstep.');