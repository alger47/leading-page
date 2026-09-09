/**
 * Typed HTTP client for the AI Engine internal contract.
 *
 * Failure taxonomy:
 * - transient (network failure, 5xx, timeout) -> `retryable: true`
 * - business (422 with a known E-AI code)      -> `retryable: false`
 * - malformed envelope (non-JSON, wrong shape)  -> E-JOB-004, not retryable
 */

import type { GenerateRequest, GenerateResponse, EngineJobPayload } from './types.js';

export interface EngineErrorOptions {
  code: string;
  retryable: boolean;
  statusCode?: number;
  cause?: unknown;
}

export class EngineError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly statusCode?: number;

  constructor(message: string, opts: EngineErrorOptions) {
    super(message, { cause: opts.cause });
    this.name = 'EngineError';
    this.code = opts.code;
    this.retryable = opts.retryable;
    this.statusCode = opts.statusCode;
  }
}

export interface EngineClientDeps {
  baseUrl: string;
  token: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

const VALID_STATUSES = new Set(['RUNNING', 'COMPLETED', 'FAILED']);

function isEngineJobPayload(value: unknown): value is EngineJobPayload {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.job_id === 'string' &&
    typeof obj.status === 'string' &&
    VALID_STATUSES.has(obj.status) &&
    Array.isArray(obj.stages) &&
    typeof obj.ledger === 'object' &&
    obj.ledger !== null &&
    typeof obj.validation === 'object' &&
    obj.validation !== null
  );
}

export class EngineClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(deps: EngineClientDeps) {
    this.baseUrl = deps.baseUrl.replace(/\/+$/, '');
    this.token = deps.token;
    this.timeoutMs = deps.timeoutMs;
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  async healthz(): Promise<boolean> {
    try {
      const res = await this.request('/healthz', { method: 'GET' });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  async generate(req: GenerateRequest): Promise<EngineJobPayload> {
    const res = await this.request('/internal/v1/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });

    let parsed: unknown;
    try {
      parsed = (await res.json()) as unknown;
    } catch (cause) {
      throw new EngineError(`engine returned non-JSON from generate`, {
        code: 'E-JOB-004',
        retryable: false,
        statusCode: res.status,
        cause,
      });
    }

    if (!res.ok) {
      const detail = this.extractDetail(parsed);
      const message = detail.message ?? `engine generate failed with HTTP ${res.status}`;
      if (res.status >= 500) {
        // Service unreachable / overloaded: transient, retried by the queue.
        throw new EngineError(message, { code: 'E-JOB-001', retryable: true, statusCode: res.status });
      }
      // Business refusal: the engine's repair ladder already bounded its retries.
      throw new EngineError(message, { code: detail.code ?? 'E-JOB-004', retryable: false, statusCode: res.status });
    }

    const payload = (parsed as GenerateResponse).job;
    if (!isEngineJobPayload(payload)) {
      throw new EngineError('engine generate returned an unexpected envelope', {
        code: 'E-JOB-004',
        retryable: false,
        statusCode: res.status,
      });
    }
    return payload;
  }

  private extractDetail(parsed: unknown): { code?: string; message?: string } {
    if (typeof parsed !== 'object' || parsed === null) return {};
    const obj = parsed as Record<string, unknown>;
    const detail = obj.detail;
    if (typeof detail === 'object' && detail !== null) {
      const d = detail as Record<string, unknown>;
      return { code: typeof d.code === 'string' ? d.code : undefined, message: typeof d.message === 'string' ? d.message : undefined };
    }
    if (typeof detail === 'string') return { message: detail };
    return {};
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: { 'x-internal-token': this.token, ...(init.headers ?? {}) },
        signal: controller.signal,
      });
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') {
        throw new EngineError(`engine request timed out after ${this.timeoutMs}ms`, {
          code: 'E-JOB-001',
          retryable: true,
          cause,
        });
      }
      throw new EngineError('engine unreachable', { code: 'E-JOB-001', retryable: true, cause });
    } finally {
      clearTimeout(timer);
    }
  }
}