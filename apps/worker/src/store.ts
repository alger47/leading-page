/**
 * In-memory job record store, keyed by job id and by idempotency key.
 * Persistence (PostgreSQL, PART X / Phase 6) replaces this; the interface
 * stays stable so the swap is local to this module.
 */

import type { JobRecord } from './jobs/types.js';
import type { SpanStore } from './telemetry.js';

export interface JobRecordStore {
  get(id: string): JobRecord | undefined;
  getByKey(idempotencyKey: string): JobRecord | undefined;
  put(record: JobRecord): void;
}

export class MemoryJobStore implements JobRecordStore {
  private readonly byId = new Map<string, JobRecord>();
  private readonly byKey = new Map<string, string>();

  get(id: string): JobRecord | undefined {
    return this.byId.get(id);
  }

  getByKey(idempotencyKey: string): JobRecord | undefined {
    const id = this.byKey.get(idempotencyKey);
    return id === undefined ? undefined : this.byId.get(id);
  }

  put(record: JobRecord): void {
    this.byId.set(record.id, record);
    this.byKey.set(record.idempotencyKey, record.id);
  }
}

/** A generated raster cached on the worker after the engine relay (Phase 16). */
export interface StoredAsset {
  ref: string;
  mime: string;
  dataB64: string;
}

export interface AssetStore {
  get(jobId: string, ref: string): StoredAsset | undefined;
  put(jobId: string, asset: StoredAsset): void;
  list(jobId: string): StoredAsset[];
}

/** Ephemeral per-job asset cache. Restart-safe by design: the web falls back
 * to its deterministic placeholder whenever a ref is missing here. */
export class MemoryAssetStore implements AssetStore {
  private readonly byJob = new Map<string, Map<string, StoredAsset>>();

  get(jobId: string, ref: string): StoredAsset | undefined {
    return this.byJob.get(jobId)?.get(ref);
  }

  put(jobId: string, asset: StoredAsset): void {
    let perJob = this.byJob.get(jobId);
    if (perJob === undefined) {
      perJob = new Map<string, StoredAsset>();
      this.byJob.set(jobId, perJob);
    }
    perJob.set(asset.ref, asset);
  }

  list(jobId: string): StoredAsset[] {
    const perJob = this.byJob.get(jobId);
    return perJob === undefined ? [] : [...perJob.values()];
  }
}

export interface JobContext {
  store: JobRecordStore;
  spans: SpanStore;
}