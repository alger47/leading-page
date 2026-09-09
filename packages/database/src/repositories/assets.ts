import type { PrismaClient, Asset, AssetKind } from '@prisma/client';
import type { Owner } from '../owner.js';
import { requireOwnedProject } from './projects.js';
import { ConflictError, NotFoundError } from '../errors.js';
import { Prisma } from '@prisma/client';

export interface AssetInput {
  kind: AssetKind;
  storageRef: string;
  url?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  sha256?: string | null;
  createdBy?: string | null;
}

const OWNERSHIP = (owner: Owner, projectId: string, assetId: string) => ({
  id: assetId,
  removedAt: null,
  project: { id: projectId, userId: owner.userId, archivedAt: null },
});

export class AssetsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(owner: Owner, projectId: string, input: AssetInput): Promise<Asset> {
    await requireOwnedProject(this.prisma, owner, projectId);
    try {
      return await this.prisma.asset.create({
        data: {
          kind: input.kind,
          storageRef: input.storageRef,
          url: input.url ?? null,
          mimeType: input.mimeType ?? null,
          sizeBytes: input.sizeBytes ?? null,
          sha256: input.sha256 ?? null,
          createdBy: input.createdBy ?? owner.userId,
          projectId,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('asset', 'storageRef', input.storageRef);
      }
      throw error;
    }
  }

  async get(owner: Owner, projectId: string, assetId: string): Promise<Asset> {
    const asset = await this.prisma.asset.findFirst({ where: OWNERSHIP(owner, projectId, assetId) });
    if (!asset) throw new NotFoundError('asset', assetId, owner.userId);
    return asset;
  }

  async list(owner: Owner, projectId: string, { kind }: { kind?: AssetKind } = {}): Promise<Asset[]> {
    await requireOwnedProject(this.prisma, owner, projectId);
    return this.prisma.asset.findMany({
      where: { projectId, removedAt: null, ...(kind ? { kind } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Soft delete (§10.4). */
  async remove(owner: Owner, projectId: string, assetId: string): Promise<Asset> {
    const asset = await this.get(owner, projectId, assetId);
    return this.prisma.asset.update({ where: { id: asset.id }, data: { removedAt: new Date() } });
  }
}