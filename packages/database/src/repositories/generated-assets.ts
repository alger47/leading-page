import type { PrismaClient, GeneratedAsset } from '@prisma/client';
import type { Owner } from '../owner.js';
import { requireOwnedProject } from './projects.js';
import { NotFoundError } from '../errors.js';

/**
 * Phase 16: durable, project-scoped engine-generated rasters.
 *
 * Refs are LOGICAL (`asset:...`) and NOT globally unique — isolating bytes is
 * the primary contract here:
 *  - storage is scoped per (projectId, jobId);
 *  - `findPublicByRef` returns bytes ONLY when the owning job's page has a
 *    LIVE published snapshot (`unpublishedAt IS NULL`), so draft assets are
 *    never reachable through the public asset route;
 *  - `getOwnedByRefForPage` resolves a ref for the dashboard preview, gated by
 *    the session owner + the page the preview renders (scoped key exchange, no
 *    global ref → data mapping).
 */
export class GeneratedAssetsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** Idempotent persist: unique (jobId, ref) — a relay/retry never duplicates. */
  async put(
    owner: Owner,
    projectId: string,
    jobId: string,
    ref: string,
    mime: string,
    bytes: Uint8Array,
    sha256: string | null = null,
  ): Promise<GeneratedAsset> {
    await requireOwnedProject(this.prisma, owner, projectId);
    const where = { jobId_ref: { jobId, ref } };
    const data = {
      projectId,
      jobId,
      ref,
      mime,
      bytes: Buffer.from(bytes),
      sha256,
    };
    return this.prisma.generatedAsset.upsert({ where, update: data, create: data });
  }

  /**
   * Public route resolution: bytes only when the owning page is LIVE-published.
   * The published snapshot is the ONLY public boundary for generated images —
   * hard to guess, never suffices (a ref alone must resolve to nothing until
   * the page is published).
   */
  async findPublicByRef(ref: string): Promise<GeneratedAsset | null> {
    return this.prisma.generatedAsset.findFirst({
      where: {
        ref,
        job: { page: { published: { some: { unpublishedAt: null } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Dashboard preview resolution: the ref must belong to a generation job of
   * the given page, and the page must be owned by the session owner. No global
   * ref lookup — the caller already holds an owned pageId. */
  async getOwnedByRefForPage(owner: Owner, pageId: string, ref: string): Promise<GeneratedAsset | null> {
    return this.prisma.generatedAsset.findFirst({
      where: {
        ref,
        job: {
          pageId,
          project: { userId: owner.userId, archivedAt: null },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(projectId: string, id: string): Promise<GeneratedAsset> {
    const asset = await this.prisma.generatedAsset.findFirst({ where: { id, projectId } });
    if (!asset) throw new NotFoundError('generated_asset', id, projectId);
    return asset;
  }
}

export interface GeneratedAssetEntry {
  ref: string;
  mime: string;
  bytes: Uint8Array;
  sha256: string | null;
}