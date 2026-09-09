import type { PrismaClient, Project } from '@prisma/client';
import type { Owner } from '../owner.js';
import { NotFoundError, fromPrisma } from '../errors.js';

export interface ProjectInput {
  name: string;
  defaultLocale?: string | null;
  tone?: string | null;
  budgetUsd?: number | string | null;
  createdBy?: string | null;
}

export interface ProjectUpdate {
  name?: string;
  defaultLocale?: string | null;
  tone?: string | null;
  budgetUsd?: number | string | null;
}

/**
 * Find a non-archived project that belongs to the owner; used as the shared
 * ownership gate by child repositories (pages, jobs, assets, publishing).
 */
export function findOwnedProject(
  prisma: PrismaClient,
  owner: Owner,
  projectId: string,
  { includeArchived = false } = {},
): Promise<Project | null> {
  return prisma.project.findFirst({
    where: {
      id: projectId,
      userId: owner.userId,
      archivedAt: includeArchived ? undefined : null,
    },
  });
}

export async function requireOwnedProject(
  prisma: PrismaClient,
  owner: Owner,
  projectId: string,
  { includeArchived = false } = {},
): Promise<Project> {
  const project = await findOwnedProject(prisma, owner, projectId, { includeArchived });
  if (!project) throw new NotFoundError('project', projectId, owner.userId);
  return project;
}

export class ProjectsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(owner: Owner, input: ProjectInput): Promise<Project> {
    try {
      return await this.prisma.project.create({
        data: {
          name: input.name,
          defaultLocale: input.defaultLocale ?? null,
          tone: input.tone ?? null,
          budgetUsd: input.budgetUsd ?? null,
          createdBy: input.createdBy ?? owner.userId,
          userId: owner.userId,
        },
      });
    } catch (error) {
      throw fromPrisma(error, { entity: 'project', field: 'userId', value: owner.userId });
    }
  }

  async list(owner: Owner, { includeArchived = false } = {}): Promise<Project[]> {
    return this.prisma.project.findMany({
      where: { userId: owner.userId, archivedAt: includeArchived ? undefined : null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(owner: Owner, projectId: string, { includeArchived = false } = {}): Promise<Project> {
    return requireOwnedProject(this.prisma, owner, projectId, { includeArchived });
  }

  async update(owner: Owner, projectId: string, data: ProjectUpdate): Promise<Project> {
    await requireOwnedProject(this.prisma, owner, projectId);
    return this.prisma.project.update({ where: { id: projectId }, data });
  }

  /** Soft delete (§10.4): the row stays, `archivedAt` is set. */
  async archive(owner: Owner, projectId: string): Promise<Project> {
    await requireOwnedProject(this.prisma, owner, projectId);
    return this.prisma.project.update({ where: { id: projectId }, data: { archivedAt: new Date() } });
  }
}