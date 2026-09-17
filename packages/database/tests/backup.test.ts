/** PostgreSQL backup script — pure helpers (GAP-6). */

import { describe, expect, it } from 'vitest';
import { buildPlan, parseDatabaseUrl, parseRetention, pruneDumps } from '../scripts/backup.js';

describe('parseDatabaseUrl', () => {
  it('parses a plain DSN', () => {
    expect(parseDatabaseUrl('postgresql://postgres:postgres@127.0.0.1:5432/landing_ai')).toEqual({
      user: 'postgres',
      password: 'postgres',
      host: '127.0.0.1',
      port: 5432,
      database: 'landing_ai',
    });
  });

  it('decodes percent-encoded userinfo', () => {
    const dsn = parseDatabaseUrl('postgresql://user%40x:p%40ss%3Awrd@db.example.com/landing_ai');
    expect(dsn.user).toBe('user@x');
    expect(dsn.password).toBe('p@ss:wrd');
  });

  it('defaults port and user when omitted', () => {
    const dsn = parseDatabaseUrl('postgresql:///analytics');
    expect(dsn.port).toBe(5432);
    expect(dsn.user).toBe('postgres');
    expect(dsn.database).toBe('analytics');
  });

  it('rejects non-postgres URLs', () => {
    expect(() => parseDatabaseUrl('mysql://root@localhost/db')).toThrow();
  });
});

describe('pruneDumps', () => {
  it('keeps the newest N timestamped dumps', () => {
    const files = [
      'backups/landing_ai-20260914T000000Z.dump',
      'backups/landing_ai-20260916T120000Z.dump',
      'backups/landing_ai-20260915T060000Z.dump',
      'landing_ai-20260913T000000Z.dump',
    ];
    expect(pruneDumps(files, 2)).toEqual([
      'backups/landing_ai-20260914T000000Z.dump',
      'landing_ai-20260913T000000Z.dump',
    ]);
  });

  it('ignores non-dump files', () => {
    expect(
      pruneDumps(['backups/README.md', 'backups/landing_ai-20260916T120000Z.dump'], 0),
    ).toEqual(['backups/landing_ai-20260916T120000Z.dump']);
  });
});

describe('parseRetention', () => {
  it('falls back to default', () => {
    expect(parseRetention(undefined)).toBe(7);
    expect(parseRetention('nope')).toBe(7);
    expect(parseRetention('0')).toBe(7);
  });
  it('accepts positive integers', () => {
    expect(parseRetention('3')).toBe(3);
  });
});

describe('buildPlan', () => {
  it('requires DATABASE_URL', () => {
    expect(() => buildPlan(undefined)).toThrow(/DATABASE_URL/);
  });

  it('requires a resolvable pg_dump', () => {
    expect(() =>
      buildPlan('postgresql://postgres:postgres@127.0.0.1:5432/landing_ai', {
        pgDumpBin: 'C:\\definitely\\missing\\pg_dump.exe',
      }),
    ).toThrow(/pg_dump not found/);
  });
});