import { PrismaClient } from '@prisma/client';

/** Default local test database; override with DATABASE_URL in any environment. */
export const DEFAULT_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/landing_ai_test';

export function databaseUrlFor(env: NodeJS.ProcessEnv = process.env): string {
  return env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

const instances = new Map<string, PrismaClient>();

/**
 * Create (or reuse) a PrismaClient bound to a specific database URL.
 * The map key makes it possible to point at several databases in one process
 * (dev vs test) without leaking connections.
 */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  let client = instances.get(databaseUrl);
  if (!client) {
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    instances.set(databaseUrl, client);
  }
  return client;
}

/** Default client bound to the configured (or test) database. */
export function getPrismaClient(env: NodeJS.ProcessEnv = process.env): PrismaClient {
  return createPrismaClient(databaseUrlFor(env));
}