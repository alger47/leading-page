/**
 * Global DB precondition for web integration tests (acceptance: "migrations
 * run clean"): drop the public schema and replay every forward-only migration
 * on the test database via `prisma migrate deploy` from the database package.
 * Mirrors packages/database/tests/global-setup.ts.
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrismaClient, DEFAULT_DATABASE_URL } from '@landing-ai/database';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const dbPkg = path.resolve(webRoot, '../../packages/database');

export default async function setup(): Promise<() => Promise<void>> {
  const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const client = createPrismaClient(url);
  await client.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
  await client.$executeRawUnsafe('CREATE SCHEMA public');
  await client.$disconnect();

  const pnpm = process.env.PNPM_CMD ?? 'C:\\Users\\FC\\AppData\\Roaming\\npm\\pnpm.cmd';
  execSync(`"${pnpm}" exec prisma migrate deploy`, {
    cwd: dbPkg,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
  return async () => undefined;
}