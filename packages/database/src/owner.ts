import type { User, Project } from '@prisma/client';

/**
 * Tenant ownership context (PART X §10.5).
 * Every repository call receives the owner; there is no "find by id" without
 * an ownership filter. Queries encode the ownership chain in their predicates
 * (e.g. `project: { id, userId: owner.userId }`).
 */
export interface Owner {
  userId: string;
}

export type ProjectRow = Project & { user?: User };

export { findOwnedProject } from './repositories/projects.js';