/**
 * PostgreSQL backup script (roadmap GAP-6: production ops).
 *
 * Dumps the landing_ai database via `pg_dump` (custom format, compressed) into
 * `backups/` with a timestamped filename, then prunes old dumps keeping the
 * newest `BACKUP_RETENTION` (default 7). Safe to run from cron/CI.
 *
 *   pnpm --filter @landing-ai/database backup
 *   pnpm --filter @landing-ai/database backup:dry-run
 *
 * Locating pg_dump (first match wins):
 *   1. PG_DUMP_BIN       – full path to the pg_dump executable
 *   2. PG_BIN            – directory containing pg_dump(.exe)
 *   3. PATH lookup
 *   4. Known local dev path (D:\postgresql-*)
 */

import { existsSync } from 'node:fs';
import { mkdir, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export interface PgDsn {
  user: string;
  password: string;
  host: string;
  port: number;
  database: string;
}

export interface BackupPlan {
  dsn: PgDsn;
  pgDumpBin: string;
  outFile: string;
  retention: number;
}

const DEFAULT_RETENTION = 7;
const WINDOWS_PG_HINTS = [
  'D:\\postgresql-18.4-2-windows-x64\\bin\\pg_dump.exe',
  'C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe',
  'C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe',
  'C:\\Program Files\\PostgreSQL\\15\\bin\\pg_dump.exe',
];

/** Parse a postgres:// DSN, decoding percent-encoded userinfo. */
export function parseDatabaseUrl(url: string): PgDsn {
  const match = /^postgres(?:ql)?:\/\/(?:([^:@/]+)(?::([^@]*))?@)?([^:/@]*)(?::(\d+))?\/([^?]+)/.exec(
    url,
  );
  if (!match) throw new Error(`cannot parse DATABASE_URL (must be postgres://...)`);
  const [, user, password, host, port, database] = match;
  const decode = (value: string | undefined): string =>
    value ? decodeURIComponent(value) : '';
  return {
    user: decode(user) || 'postgres',
    password: decode(password),
    host: decode(host) || '127.0.0.1',
    port: port ? Number.parseInt(port, 10) : 5432,
    database: decode(database),
  };
}

/** Keep the `keep` newest dumps (by embedded timestamp), return prune list. */
export function pruneDumps(paths: string[], keep: number): string[] {
  const WINDOW_LABEL = /-\d{8}T\d{6}Z\.dump$/;
  const basename = (file: string) =>
    file.slice(Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')) + 1);
  const dated = paths
    .filter((file) => WINDOW_LABEL.test(file))
    .sort((a, b) => basename(b).localeCompare(basename(a)));
  return dated.slice(keep);
}

export function discoveryCandidates(pgDumpBin?: string, pgBin?: string): string[] {
  const candidates: string[] = [];
  if (pgDumpBin) candidates.push(pgDumpBin);
  if (pgBin) candidates.push(pgBin.endsWith('pg_dump') ? pgBin : path.join(pgBin, 'pg_dump'));
  candidates.push(process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump');
  if (process.platform === 'win32') candidates.push(...WINDOWS_PG_HINTS);
  return candidates;
}

export function resolvePgDump(pgDumpBin?: string, pgBin?: string): string | null {
  if (pgDumpBin) {
    return existsSync(pgDumpBin) ? pgDumpBin : null;
  }
  for (const candidate of discoveryCandidates(undefined, pgBin)) {
    if (path.isAbsolute(candidate) && existsSync(candidate)) return candidate;
    if (!path.isAbsolute(candidate) && findOnPath(candidate)) return candidate;
  }
  return null;
}

function findOnPath(executable: string): boolean {
  const dirs = (process.env.PATH ?? '').split(path.delimiter);
  const lookups = process.platform === 'win32' ? [executable, `${executable}.exe`] : [executable];
  return dirs.some((dir) => lookups.some((name) => existsSync(path.join(dir, name))));
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

/** Compact UTC timestamp that sorts lexicographically and is DOS/FS-safe. */
export function timestamp(now: Date): string {
  return (
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`
  );
}

export function buildPlan(
  databaseUrl: string | undefined,
  options: { retention?: number; pgDumpBin?: string; pgBin?: string; outDir?: string } = {},
): BackupPlan {
  if (!databaseUrl) throw new Error('DATABASE_URL is required (pass it or set the env var)');
  const dsn = parseDatabaseUrl(databaseUrl);
  const pgDumpBin = resolvePgDump(options.pgDumpBin, options.pgBin);
  if (!pgDumpBin) {
    throw new Error(
      `pg_dump not found. Set PG_DUMP_BIN to its full path (e.g. D:\\postgresql-18.4-2-windows-x64\\bin\\pg_dump.exe).`,
    );
  }
  const retention = options.retention ?? parseRetention(process.env.BACKUP_RETENTION);
  const outDir = options.outDir ?? process.env.BACKUP_DIR ?? 'backups';
  const outFile = path.join(outDir, `${dsn.database}-${timestamp(new Date())}.dump`);
  return { dsn, pgDumpBin, outFile, retention };
}

export function parseRetention(raw: string | undefined, fallback = DEFAULT_RETENTION): number {
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 1 ? value : fallback;
}

export async function runBackup(plan: BackupPlan): Promise<{ pruned: string[] }> {
  await mkdir(path.dirname(plan.outFile), { recursive: true });
  const env = { ...process.env, PGPASSWORD: plan.dsn.password };
  const result = spawnSync(
    plan.pgDumpBin,
    [
      '--format=custom',
      '--no-password',
      '--exit-on-error',
      '--file',
      plan.outFile,
      plan.dsn.database,
    ],
    {
      env,
      encoding: 'utf-8',
      timeout: 30 * 60 * 1000,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `pg_dump failed (exit ${result.status ?? 'spawn'}): ${result.error?.message ?? result.stderr}`.trim(),
    );
  }
  const existing = (await readdir(path.dirname(plan.outFile))).map((file) =>
    path.join(path.dirname(plan.outFile), file),
  );
  const pruned = pruneDumps(existing, plan.retention);
  await Promise.all(pruned.map((file) => unlink(file)));
  return { pruned };
}

export function printPlan(plan: BackupPlan): string {
  return [
    `database : ${plan.dsn.host}:${plan.dsn.port}/${plan.dsn.database}`,
    `pg_dump  : ${plan.pgDumpBin}`,
    `output   : ${plan.outFile}`,
    `retention: ${plan.retention} dumps`,
  ].join('\n');
}

async function main(): Promise<void> {
  const isDryRun = process.argv.includes('--dry-run');
  const plan = buildPlan(process.env.DATABASE_URL, {
    pgDumpBin: process.env.PG_DUMP_BIN,
    pgBin: process.env.PG_BIN,
    outDir: process.env.BACKUP_DIR,
  });
  console.log(printPlan(plan));
  if (isDryRun) {
    console.log('dry-run: no backup written');
    return;
  }
  const { pruned } = await runBackup(plan);
  console.log(`backup written: ${plan.outFile}`);
  if (pruned.length > 0) console.log(`pruned ${pruned.length} old dump(s)`);
}

if (process.argv[1]?.endsWith('backup.ts')) {
  void main().catch((error: unknown) => {
    console.error(`backup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}