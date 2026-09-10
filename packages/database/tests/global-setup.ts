import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { DEFAULT_DATABASE_URL } from '../src/client.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..');

/**
 * Global DB precondition (acceptance: "migrations run clean"):
 *  - targets the configured DATABASE_URL (default: local landing_ai_test)
 *  - drops the public schema so runs are deterministic
 *  - replays every forward-only migration via `prisma migrate deploy`
 */
export default async function setup(): Promise<() => Promise<void>> {
  const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const client = new PrismaClient({ datasources: { db: { url } } });
  await client.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
  await client.$executeRawUnsafe('CREATE SCHEMA public');
  await client.$disconnect();

  const pnpm = process.env.PNPM_CMD ?? 'pnpm';
  execSync(`"${pnpm}" exec prisma migrate deploy`, {
    cwd: pkgRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
  return async () => undefined;
}