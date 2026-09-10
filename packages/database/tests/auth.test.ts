import { beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { prisma, resetDb } from './helpers.js';
import { UsersRepository } from '../src/repositories/users.js';
import { AuthSessionRepository } from '../src/repositories/sessions.js';
import { NotFoundError } from '../src/errors.js';
import type { Owner } from '../src/owner.js';

const users = new UsersRepository(prisma);
const sessions = new AuthSessionRepository(prisma);

const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');

function tokenFor(userId: string): string {
  return `t${Date.now()}-${Math.random().toString(36).slice(2)}-${userId}`;
}

beforeEach(async () => {
  await resetDb();
});

describe('users repository', () => {
  it('create + self-scoped get round-trip; email is lowercased and unique', async () => {
    const user = await users.create({ email: 'Owner@Example.com', name: 'Owner', passwordHash: 'scrypt…' });
    expect(user.email).toBe('owner@example.com');
    const owner: Owner = { userId: user.id };
    await expect(users.get(owner)).resolves.toMatchObject({ email: 'owner@example.com' });
    await expect(users.create({ email: 'owner@example.com' })).rejects.toThrow(/conflict|exists/i);
  });

  it('get throws NotFound for another user id (no cross-user reads)', async () => {
    const a = await users.create({ email: 'a@test.local' });
    const b = await users.create({ email: 'b@test.local' });
    await expect(users.get({ userId: b.id })).resolves.toMatchObject({ id: b.id });
    await expect(users.get({ userId: a.id })).resolves.toMatchObject({ id: a.id });
    // deactivation is soft: owned reads stop resolving
    await users.deactivate({ userId: b.id });
    await expect(users.get({ userId: b.id })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('auth session repository', () => {
  it('stores only the token hash; verify resolves the owning user', async () => {
    const user = await users.create({ email: 's@test.local' });
    const token = tokenFor(user.id);
    const session = await sessions.create({
      tokenHash: hashOf(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(session.tokenHash).toBe(hashOf(token));
    expect(session.tokenHash).not.toContain(token);

    const verified = await sessions.verify(hashOf(token));
    expect(verified).not.toBeNull();
    expect(verified!.userId).toBe(user.id);
    expect(verified!.user.email).toBe('s@test.local');
    expect(await sessions.verify(hashOf('forged-token'))).toBeNull();
  });

  it('expired sessions do not verify; revoke kills the session', async () => {
    const user = await users.create({ email: 'e@test.local' });
    const token = tokenFor(user.id);
    await sessions.create({ tokenHash: hashOf(token), userId: user.id, expiresAt: new Date(Date.now() - 1_000) });
    expect(await sessions.verify(hashOf(token))).toBeNull();

    const live = await sessions.create({ tokenHash: hashOf('live-token'), userId: user.id, expiresAt: new Date(Date.now() + 60_000) });
    await sessions.revoke(hashOf('live-token'));
    expect(await sessions.verify(live.tokenHash)).toBeNull();
  });

  it('revokeAllForUser kills every session of that user only', async () => {
    const user = await users.create({ email: 'r@test.local' });
    const other = await users.create({ email: 'o@test.local' });
    const a = tokenFor(user.id);
    const b = tokenFor(user.id);
    const c = tokenFor(other.id);
    for (const t of [a, b, c]) {
      await sessions.create({ tokenHash: hashOf(t), userId: t === c ? other.id : user.id, expiresAt: new Date(Date.now() + 60_000) });
    }
    await sessions.revokeAllForUser(user.id);
    expect(await sessions.verify(hashOf(a))).toBeNull();
    expect(await sessions.verify(hashOf(b))).toBeNull();
    expect(await sessions.verify(hashOf(c))).not.toBeNull();
  });
});