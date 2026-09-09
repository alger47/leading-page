/**
 * Typed shapes for the AI Engine internal HTTP contract
 * (apps/ai-engine/app/contracts.py JobResult.to_dict + routes).
 */

export interface EngineAttemptDetail {
  stage: string;
  attempt: number;
  prompt: string;
  model_class: string;
  provider: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  latency_ms: number;
  outcome: string;
  issues: unknown[];
}

export interface EngineStage {
  stage: string;
  ok: boolean;
  attempts: number;
  fallback_used: boolean;
  repaired: boolean;
  draft: boolean;
  error_code: string | null;
  cost_usd: number;
  issues: unknown[];
}

export interface EngineLedger {
  attempts: number;
  cost_usd: number;
  duration_ms: number;
  attempts_detail: EngineAttemptDetail[];
}

export interface EngineJobPayload {
  job_id: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  error_code?: string | null;
  error_message?: string | null;
  brief_flags: Record<string, unknown>;
  stages: EngineStage[];
  ledger: EngineLedger;
  validation: { errors: number; warnings: number };
  page?: Record<string, unknown> | null;
  page_validation?: Record<string, unknown> | null;
  build_issues: unknown[];
  headers_preview: Record<string, string>;
}

export interface GenerateRequest {
  brief: string;
  locale?: string;
  tone?: string;
  job_id?: string;
  budget_usd?: number;
}

export interface GenerateResponse {
  job: EngineJobPayload;
}