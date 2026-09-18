/**
 * Job domain types (mirror PART X §10.2 GenerationJob + §11.4 stable events).
 * E-JOB-0xx: cancelled / worker crash recovery / idempotency conflict.
 */

import type { EngineJobPayload } from '../engine/types.js';

export type JobStatus = 'QUEUED' | 'RUNNING' | 'VALIDATING' | 'RENDERING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

/** Stable stage event names (§11.4). Layout-planner and post-render stages
 * are deliberately absent: the engine exposes no stable event for layout and
 * assets/rendering land in later phases. */
export const STAGE_EVENT_BY_ENGINE_STAGE: Record<string, string> = {
  'brief-analyzer': 'stage.brief_analyzed',
  'page-planner': 'stage.page_planned',
  'content-generator': 'stage.content_generated',
  'schema-builder': 'stage.schema_built',
  'page-validator': 'stage.validated',
};

export const JOB_EVENT_TYPES = [
  'job.queued',
  'job.started',
  'job.retried',
  'job.completed',
  'job.failed',
  'job.cancelled',
  ...Object.values(STAGE_EVENT_BY_ENGINE_STAGE),
] as const;

export type JobEventType = (typeof JOB_EVENT_TYPES)[number];

export interface JobEvent {
  type: JobEventType;
  at: string;
  code?: string;
  detail?: string;
}

/** E-JOB-0xx family (APPENDIX E). */
export const E_JOB = {
  unreachable: 'E-JOB-001', // transient engine failures exhausted
  idempotencyConflict: 'E-JOB-002', // same key, different payload
  cancelled: 'E-JOB-003',
  malformedResponse: 'E-JOB-004', // engine returned an unexpected envelope
  crashRecovery: 'E-JOB-005', // worker died mid-job; processing is being resumed
} as const;

export type GenerationMode = 'full' | 'section';

export interface GenerationRequest {
  brief: string;
  locale?: 'ar' | 'fr' | 'en';
  tone?: string;
  budgetUsd?: number;
  /** 'full' generates the whole page; 'section' regenerates one section from
   * the supplied current Page Schema (Phase 8 J2). */
  mode?: GenerationMode;
  targetSectionId?: string;
  /** Current Page Schema, required when mode === 'section'. */
  page?: unknown;
  /** Opt into engine Stage 6 image generation (asset-renderer). The engine
   * feature itself stays OFF until AI_IMAGE_PROVIDER is configured, so this
   * flag is harmless when the deployment has no image provider. Phase 16. */
  generateImages?: boolean;
}

/** Serialized onto the BullMQ job. */
export interface JobPayload extends GenerationRequest {
  idempotencyKey: string;
  fingerprint: string;
}

export interface JobRecord {
  id: string;
  idempotencyKey: string;
  fingerprint: string;
  label: string;
  request: GenerationRequest;
  traceId: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  attemptsMade: number;
  errorCode?: string;
  errorMessage?: string;
  engineJobId?: string;
  engineStatus?: string;
  result?: EngineJobPayload;
  events: JobEvent[];
}

export const TERMINAL_STATUSES: readonly JobStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

export function isTerminal(status: JobStatus): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function labelFor(request: GenerationRequest): string {
  const firstLine = request.brief.split('\n')[0]?.trim() ?? '';
  const snippet = firstLine.length > 48 ? `${firstLine.slice(0, 45)}...` : firstLine;
  return snippet || '(empty brief)';
}