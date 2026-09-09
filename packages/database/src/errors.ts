import { Prisma } from '@prisma/client';

/** Base class for all persistence-layer failures. */
export class RepositoryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/** Read/update targeted a row that does not exist for the given owner. */
export class NotFoundError extends RepositoryError {
  constructor(entity: string, id: string, ownerId: string) {
    super('NOT_FOUND', `${entity} ${id} not found for owner ${ownerId}`);
  }
}

/** Uniqueness violation (dup idempotency key, host, storage ref, email, ...). */
export class ConflictError extends RepositoryError {
  constructor(entity: string, field: string, value: string) {
    super('CONFLICT', `${entity} with ${field}=${value} already exists`);
  }
}

/** The row's base version changed since it was read. */
export class OptimisticConcurrencyError extends RepositoryError {
  readonly baseVersion: number;
  readonly currentVersion: number;
  constructor(entity: string, expected: number, actual: number) {
    super(
      'OPTIMISTIC_CONCURRENCY',
      `${entity}: expected base version ${expected}, current is ${actual} (concurrent edit detected)`,
    );
    this.baseVersion = expected;
    this.currentVersion = actual;
  }
}

/** The repository refused to persist a document that fails L1 validation. */
export class InvalidContentError extends RepositoryError {
  constructor(path: string, message: string) {
    super('INVALID_CONTENT', `L1 validation failed at ${path}: ${message}`);
  }
}

/** Job status transition violated the state machine. */
export class StateTransitionError extends RepositoryError {
  constructor(jobId: string, from: string, to: string) {
    super('STATE_TRANSITION', `job ${jobId}: cannot transition ${from} -> ${to}`);
  }
}

/** Map common Prisma errors to typed repository errors. */
export function fromPrisma(error: unknown, context: { entity: string; field?: string; value?: string }): RepositoryError {
  if (error instanceof RepositoryError) return error;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      const field = context.field ?? (error.meta as { target?: string[] } | undefined)?.target?.[0] ?? 'unique';
      return new ConflictError(context.entity, field, context.value ?? '');
    }
    if (error.code === 'P2025') {
      return new NotFoundError(context.entity, context.value ?? '', '?');
    }
  }
  return new RepositoryError('DATABASE', error instanceof Error ? error.message : String(error));
}