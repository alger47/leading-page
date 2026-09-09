import type { PrismaClient, PromptVersion } from '@prisma/client';
import { ConflictError } from '../errors.js';

export interface PromptVersionInput {
  stage: string;
  name: string;
  version: number;
  contentHash: string;
  contentRef: string;
}

/** Registry of prompt assets (PART X §10.1). Read-mostly, versioned by stage. */
export class PromptVersionsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(): Promise<PromptVersion[]> {
    return this.prisma.promptVersion.findMany({ orderBy: [{ stage: 'asc' }, { version: 'asc' }] });
  }

  async latestFor(stage: string): Promise<PromptVersion | null> {
    return this.prisma.promptVersion.findFirst({
      where: { stage },
      orderBy: { version: 'desc' },
    });
  }

  /**
   * Register a prompt asset version. Unique (stage, version): registering the
   * same version twice is a no-op (idempotent), registering a different hash
   * under an existing version conflicts.
   */
  async register(input: PromptVersionInput): Promise<PromptVersion> {
    const existing = await this.prisma.promptVersion.findUnique({
      where: { stage_version: { stage: input.stage, version: input.version } },
    });
    if (existing) {
      if (existing.contentHash !== input.contentHash) {
        throw new ConflictError('prompt_version', `${input.stage}@${input.version}`, input.contentHash);
      }
      return existing;
    }
    return this.prisma.promptVersion.create({ data: input });
  }
}