import type { PrismaClient, User } from '@prisma/client';
import type { Owner } from '../owner.js';
import { NotFoundError, fromPrisma } from '../errors.js';

export interface UserInput {
  email: string;
  name?: string | null;
  /** scrypt hash string; optional so provider/seed paths can create users later */
  passwordHash?: string | null;
}

export interface UserUpdate {
  name?: string | null;
  passwordHash?: string | null;
}

/**
 * User lifecycle (auth layer). Tenant rule (§10.5) applied at its root: a user
 * row is only readable by the owning session itself — there is no cross-user
 * lookup. `getByEmail` is the auth-boundary exception (login) and never returns
 * password state beyond what the auth service needs.
 */
export class UsersRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: UserInput): Promise<User> {
    try {
      return await this.prisma.user.create({
        data: {
          email: input.email.toLowerCase(),
          name: input.name ?? null,
          passwordHash: input.passwordHash ?? null,
        },
      });
    } catch (error) {
      throw fromPrisma(error, { entity: 'user', field: 'id', value: input.email });
    }
  }

  /** Read the user matching this very session's owner (self-scoped). */
  async get(owner: Owner): Promise<User> {
    const user = await this.prisma.user.findFirst({
      where: { id: owner.userId, deactivatedAt: null },
    });
    if (!user) throw new NotFoundError('user', owner.userId, owner.userId);
    return user;
  }

  /** Auth-boundary lookup (login/register). Never used by tenant-scoped reads. */
  async getByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
  }

  async update(owner: Owner, data: UserUpdate): Promise<User> {
    await this.get(owner);
    try {
      return await this.prisma.user.update({ where: { id: owner.userId }, data });
    } catch (error) {
      throw fromPrisma(error, { entity: 'user', field: 'id', value: owner.userId });
    }
  }

  /** Soft delete (§10.4). Keeps the row, drops it from every owned query. */
  async deactivate(owner: Owner): Promise<User> {
    await this.get(owner);
    return this.prisma.user.update({
      where: { id: owner.userId },
      data: { deactivatedAt: new Date() },
    });
  }
}