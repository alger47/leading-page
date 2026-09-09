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

export interface JobContext {
  store: JobRecordStore;
  spans: SpanStore;
}