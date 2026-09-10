/**
 * Password hashing with node:crypto scrypt (NIST-approved KDF, zero
 * dependencies). Stored form: `scrypt$N$r$p$saltB64$hashB64`.
 * Timing-safe comparison on verify; malformed or foreign formats are rejected.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>;

const N = 16384; // 2**14 — OWASP-recommended floor
const R = 8;
const P = 1;
const KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/** Brutal, no-oracle verify. Non-matching formats return false (never throw to callers). */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const Nv = Number.parseInt(parts[1], 10);
  const rv = Number.parseInt(parts[2], 10);
  const pv = Number.parseInt(parts[3], 10);
  if (Number.isNaN(Nv) || Number.isNaN(rv) || Number.isNaN(pv) || Nv <= 0 || rv <= 0 || pv <= 0) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], 'base64');
    expected = Buffer.from(parts[5], 'base64');
  } catch {
    return false;
  }
  const key = await scrypt(password, salt, KEYLEN, { N: Nv, r: rv, p: pv });
  return key.length === expected.length && timingSafeEqual(key, expected);
}