/**
 * scrypt password hashing: roundtrip, wrong password, malformed/foreign
 * formats, and tampering must not false-positive.
 */
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../lib/auth/password.js';

describe('scrypt password hashing', () => {
  it('roundtrips a known password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.startsWith('scrypt$16384$8$1$')).toBe(true);
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('right-password');
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('does not leak the password or salt in plaintext', async () => {
    const hash = await hashPassword('s3cret!');
    expect(hash).not.toContain('s3cret!');
  });

  it('rejects malformed and foreign formats', async () => {
    expect(await verifyPassword('x', 'not-a-valid-format')).toBe(false);
    expect(await verifyPassword('x', 'bcrypt$10$whatever')).toBe(false);
    expect(await verifyPassword('x', null)).toBe(false);
    expect(await verifyPassword('x', undefined)).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
  });

  it('produces a unique salt each time', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same', a)).toBe(true);
    expect(await verifyPassword('same', b)).toBe(true);
  });
});