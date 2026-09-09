/**
 * Schema Migrations
 * 
 * Pure, tested functions to migrate Page Schema from one version to another.
 * Per master prompt §4.3:
 * - Published pages keep rendering with the schema version they were published with
 * - Migrations never break live pages mid-life
 */

export type MigrationFunction = (document: Record<string, unknown>) => Record<string, unknown>;

export interface Migration {
  fromVersion: string;
  toVersion: string;
  migrate: MigrationFunction;
  description: string;
}

/**
 * Registry of all migrations, ordered by version.
 */
export const MIGRATIONS: Migration[] = [
  // Future migrations will be added here
  // Example:
  // {
  //   fromVersion: '1.0.0',
  //   toVersion: '1.1.0',
  //   migrate: (doc) => { ... },
  //   description: 'Add new optional field to hero section'
  // }
];

/**
 * Get the migration path between two schema versions.
 * 
 * @param fromVersion - Source version
 * @param toVersion - Target version
 * @returns Array of migrations to apply in order, or null if path not found
 */
export function getMigrationPath(
  fromVersion: string,
  toVersion: string
): Migration[] | null {
  if (fromVersion === toVersion) return [];

  const path: Migration[] = [];
  let currentVersion = fromVersion;

  while (currentVersion !== toVersion) {
    const nextMigration = MIGRATIONS.find((m) => m.fromVersion === currentVersion);
    
    if (!nextMigration) {
      return null; // No migration path found
    }

    path.push(nextMigration);
    currentVersion = nextMigration.toVersion;
  }

  return path;
}

/**
 * Apply migrations to a document.
 * 
 * @param document - The Page Schema document to migrate
 * @param fromVersion - Expected current version
 * @param toVersion - Target version (or 'latest')
 * @returns Migrated document
 * @throws Error if migration path not found or migration fails
 */
export function migrateDocument(
  document: Record<string, unknown>,
  fromVersion: string,
  toVersion: string
): Record<string, unknown> {
  const targetVersion = toVersion === 'latest' 
    ? MIGRATIONS[MIGRATIONS.length - 1]?.toVersion || fromVersion
    : toVersion;

  const path = getMigrationPath(fromVersion, targetVersion);
  
  if (path === null) {
    throw new Error(`No migration path from ${fromVersion} to ${targetVersion}`);
  }

  let result = { ...document };

  for (const migration of path) {
    try {
      result = migration.migrate(result);
      result.schemaVersion = migration.toVersion;
    } catch (error) {
      throw new Error(
        `Migration failed: ${migration.fromVersion} → ${migration.toVersion}: ${error}`
      );
    }
  }

  return result;
}

/**
 * Check if a document needs migration.
 * 
 * @param document - The Page Schema document
 * @param targetVersion - Target version to check against
 * @returns true if migration is needed
 */
export function needsMigration(
  document: Record<string, unknown>,
  targetVersion: string
): boolean {
  const currentVersion = document.schemaVersion as string;
  return currentVersion !== targetVersion;
}
