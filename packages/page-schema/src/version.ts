/**
 * Schema Version Policy
 * 
 * Per master prompt §4.3:
 * - schemaVersion follows semver: MAJOR = breaking, MINOR = additive, PATCH = docs/clarification
 * - Every persisted PageVersion stores its schemaVersion
 * - Published pages keep rendering with the schema version they were published with
 */

export const CURRENT_SCHEMA_VERSION = '1.0.0';

export function compareVersions(a: string, b: string): number {
  const [aMajor, aMinor, aPatch] = a.split('.').map(Number);
  const [bMajor, bMinor, bPatch] = b.split('.').map(Number);

  if (aMajor !== bMajor) return aMajor - bMajor;
  if (aMinor !== bMinor) return aMinor - bMinor;
  return aPatch - bPatch;
}

export function isValidSemver(version: string): boolean {
  return /^[0-9]+\.[0-9]+\.[0-9]+$/.test(version);
}