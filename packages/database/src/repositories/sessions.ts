import type { AuthSession, PrismaClient, User } from '@prisma/client';
import { NotFoundError, fromPrisma } from '../errors.js';

/**
 * Server-side session store (Phase 7 auth). Only the SHA-256 hash of the
 * opaque session token is ever persisted. Lookups are keyed by `tokenHash` —
 * the auth boundary — not by user; a valid session resolves to its owning user,
 * and every request then runs as that `Owner` through the tenant-scoped repos.
 */
export class AuthSessionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: { tokenHash: string; userId: string; expiresAt: Date }): Promise<AuthSession> {
    try {
      return await this.prisma.authSession.create({ data: input });
    } catch (error) {
      throw fromPrisma(error, { entity: 'auth_session', field: 'userId', value: input.userId });
    }
  }

  /** Active (unexpired, non-revoked) session for a token hash, joined to its user. */
  async verify(tokenHash: string, now: Date = new Date()): Promise<(AuthSession & { user: User }) | null> {
    const session = await this.prisma.authSession.findFirst({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: now } },
      include: { user: true },
    });
    if (!session) return null;
    return session;
  }

  async touch(tokenHash: string, now: Date = new Date()): Promise<void> {
    await this.prisma.authSession.update({ where: { tokenHash }, data: { lastUsedAt: now } }).catch(() => undefined);
  }

  /** Soft-revoke one session. */
  async revoke(tokenHash: string, now: Date = new Date()): Promise<void> {
    await this.prisma.authSession
      .update({
        where: { tokenHash },
        data: { revokedAt: now, expiresAt: now },
      })
      .catch(() => {
        throw new NotFoundError('auth_session', tokenHash.slice(0, 8), 'session');
      });
  }

  /** Soft-revoke every session of a user (e.g. password change / deactivation). */
  async revokeAllForUser(userId: string, now: Date = new Date()): Promise<void> {
    try {
      await this.prisma.authSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now, expiresAt: now },
      });
    } catch (error) {
      throw fromPrisma(error, { entity: 'auth_session', field: 'userId', value: userId });
    }
  }
}