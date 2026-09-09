/**
 * @landing-ai/database — PostgreSQL persistence layer (PART X).
 * Prisma schema, forward-only migrations, tenant-scoped repositories.
 *
 * Repository rule (normative §10.5): no read/write without an ownership
 * filter. Every method takes an `Owner` and encodes the ownership chain
 * (User → Project → Page → Version/Job/Asset) in its SQL predicates.
 */

export { DEFAULT_DATABASE_URL, databaseUrlFor, createPrismaClient, getPrismaClient } from './client.js';
export {
  RepositoryError,
  NotFoundError,
  ConflictError,
  OptimisticConcurrencyError,
  InvalidContentError,
  StateTransitionError,
  fromPrisma,
} from './errors.js';
export type { Owner, ProjectRow } from './owner.js';

export { ProjectsRepository, findOwnedProject, requireOwnedProject } from './repositories/projects.js';
export type { ProjectInput, ProjectUpdate } from './repositories/projects.js';
export { PagesRepository } from './repositories/pages.js';
export type { PageInput, SaveVersionInput } from './repositories/pages.js';
export { JobsRepository, canTransition } from './repositories/jobs.js';
export type {
  JobStatus,
  JobEvent,
  CreateJobInput,
  TransitionOptions,
  RecordAttemptInput,
} from './repositories/jobs.js';
export { AssetsRepository } from './repositories/assets.js';
export type { AssetInput } from './repositories/assets.js';
export { PublishingRepository } from './repositories/published.js';
export type { PublishInput, PublishOptions } from './repositories/published.js';
export { PromptVersionsRepository } from './repositories/prompts.js';
export type { PromptVersionInput } from './repositories/prompts.js';

export type {
  User,
  Project,
  Page,
  PageVersion,
  Asset,
  GenerationJob,
  GenerationAttempt,
  PublishedPage,
  PublicationEvent,
  Subdomain,
  PromptVersion,
} from '@prisma/client';