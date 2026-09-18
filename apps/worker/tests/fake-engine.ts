/**
 * In-memory stand-in for the AI Engine's internal HTTP contract. Scenario
 * knobs drive the failure-injection tests (timeout, malformed, transient,
 * refusal / E-AI-005, L0 rejection, budget exhaustion).
 */

import Fastify, { type FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';

export type ScenarioMode = 'ok' | 'business-fail' | 'l0-reject' | 'budget-fail' | 'transient' | 'timeout' | 'malformed';

export interface Scenario {
  mode: ScenarioMode;
  transientRemaining?: number;
  delayMs?: number;
  /** Emit a Stage 6 asset-renderer manifest in the COMPLETED envelope and
   * serve the fake bytes via GET /internal/v1/assets/:jobId/:ref. */
  assets?: boolean;
  /** Keep the manifest but make the bytes endpoint 404 — simulates engine
   * restart/eviction; the worker must fall back to the placeholder. */
  assetsMissing?: boolean;
}

export interface EngineCall {
  job_id?: string;
  brief: string;
  locale?: string;
  tone?: string;
  budget_usd?: number;
  target_section_id?: string;
  page?: Record<string, unknown>;
  generate_images?: boolean;
  supplied_images?: Array<{ ref: string; mime: string; data_b64: string }>;
}

export interface FakeEngine {
  app: FastifyInstance;
  scenario: Scenario;
  calls: EngineCall[];
  paths: string[];
  setScenario(s: Scenario): void;
  start(): Promise<string>;
  stop(): Promise<void>;
}

function stage(name: string, ok = true): Record<string, unknown> {
  return {
    stage: name,
    ok,
    attempts: ok ? 1 : 0,
    fallback_used: false,
    repaired: false,
    draft: false,
    error_code: ok ? null : 'E-AI-005',
    cost_usd: ok ? 0.001 : 0,
    issues: [],
  };
}

function okPayload(jobId?: string, assets?: boolean): Record<string, unknown> {
  return {
    job: {
      job_id: jobId ?? 'engine-job-1',
      status: 'COMPLETED',
      brief_flags: {},
      stages: [
        stage('brief-analyzer'),
        stage('persona-builder'),
        stage('page-planner'),
        stage('layout-planner'),
        stage('content-generator'),
        stage('schema-builder'),
        stage('page-validator'),
      ],
      ...(assets === true
        ? {
            assets: [
              { ref: 'asset:hero-x', requirement_id: 'hero-x', mime: 'image/png', size_bytes: 12, source: 'generated' },
              { ref: 'asset:feat-y', requirement_id: 'feat-y', mime: 'image/png', size_bytes: 12, source: 'generated' },
            ],
          }
        : {}),
      ledger: {
        attempts: 7,
        cost_usd: 0.007,
        duration_ms: 415,
        attempts_detail: [
          {
            stage: 'brief-analyzer',
            attempt: 1,
            prompt: 'brief-analyzer@1.0.0',
            model_class: 'analysis',
            provider: 'stub',
            model: 'stub/instruct',
            tokens_in: 90,
            tokens_out: 40,
            cost_usd: 0.0001,
            latency_ms: 12.4,
            outcome: 'ok',
            issues: [],
          },
        ],
      },
      validation: { errors: 0, warnings: 1 },
      page: {
        schemaVersion: '1.0.0',
        meta: { locale: 'ar', direction: 'rtl', title: 'عيادة بيطرية' },
        theme: { fonts: { heading: 'cairo', body: 'cairo' }, colors: { primary: { role: 'primary' } }, radius: 'medium', density: 'comfortable' },
        sections: [{ type: 'header' }, { type: 'hero' }, { type: 'features' }, { type: 'cta' }, { type: 'footer' }],
        assets: [],
      },
      page_validation: { valid: true, errors: [], warnings: [], issues: [] },
      build_issues: [],
      headers_preview: { hero: 'عيادة بيطرية' },
    },
  };
}

function sectionOkPayload(request: EngineCall, jobId?: string): Record<string, unknown> {
  const payload = okPayload(jobId);
  const job = payload.job as { stages: Array<Record<string, unknown>>; page: { sections: Array<Record<string, unknown>> }; brief_flags: Record<string, unknown> };
  const page = request.page as { sections: Array<Record<string, unknown>> } | undefined;
  const sections = page?.sections ?? [{ type: 'header' }, { type: 'hero' }, { type: 'footer' }];
  job.brief_flags = { mode: 'section', target_section_id: request.target_section_id, source_l1_valid: true };
  job.stages = [stage('content-generator')];
  job.page = {
    ...job.page,
    sections: sections.map((section) => ({ ...section, content: { title: `${section.type ?? 'section'} regenerated` } })),
  };
  return payload;
}

function businessFailPayload(jobId: string | undefined, errorCode: string, message: string): Record<string, unknown> {
  return {
    job: {
      job_id: jobId ?? 'engine-job-1',
      status: 'FAILED',
      error_code: errorCode,
      error_message: message,
      brief_flags: {},
      stages: [{ stage: 'brief-analyzer', ok: true, attempts: 1, fallback_used: false, repaired: false, draft: false, error_code: null, cost_usd: 0.001, issues: [] }],
      ledger: { attempts: 1, cost_usd: 0.001, duration_ms: 30, attempts_detail: [] },
      validation: { errors: 0, warnings: 0 },
      page: null,
      page_validation: null,
      build_issues: [],
      headers_preview: {},
    },
  };
}

export function makeFakeEngine(): FakeEngine {
  const scenario: Scenario = { mode: 'ok' };
  const calls: EngineCall[] = [];
  const paths: string[] = [];
  const app = Fastify({ logger: false });

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.post<{ Body: EngineCall }>('/internal/v1/generate', async (request, reply) => {
    calls.push(request.body);
    paths.push('/internal/v1/generate');
    const body = request.body;

    switch (scenario.mode) {
      case 'transient': {
        const remaining = (scenario.transientRemaining ?? 1) - 1;
        if (remaining >= 0) {
          scenario.transientRemaining = remaining;
          reply.status(503).send({ detail: 'upstream temporarily unavailable' });
          return reply;
        }
        reply.send(okPayload(body.job_id, scenario.assets === true));
        return reply;
      }
      case 'timeout': {
        if ((scenario.delayMs ?? 0) > 0) {
          await new Promise((resolve) => setTimeout(resolve, scenario.delayMs));
        }
        reply.send(okPayload(body.job_id, scenario.assets === true));
        return reply;
      }
      case 'malformed':
        reply.type('application/json').send('this is not json');
        return reply;
      case 'business-fail':
        reply.send(businessFailPayload(body.job_id, 'E-AI-005', 'provider refused the request'));
        return reply;
      case 'budget-fail':
        reply.send(businessFailPayload(body.job_id, 'E-AI-002', 'job budget exceeded'));
        return reply;
      case 'l0-reject':
        reply.status(422).send({ detail: { code: 'E-AI-001', message: 'brief rejected: injection detected' } });
        return reply;
      default:
        reply.send(okPayload(body.job_id, scenario.assets === true));
        return reply;
    }
  });

  app.post<{ Body: EngineCall }>('/internal/v1/regenerate-section', async (request, reply) => {
    calls.push(request.body);
    paths.push('/internal/v1/regenerate-section');
    const body = request.body;
    switch (scenario.mode) {
      case 'business-fail':
        reply.send(businessFailPayload(body.job_id, 'E-AI-005', 'provider refused the request'));
        return reply;
      case 'l0-reject':
        reply.status(422).send({ detail: { code: 'E-AI-001', message: 'brief rejected: injection detected' } });
        return reply;
      default:
        reply.send(sectionOkPayload(body, body.job_id));
        return reply;
    }
  });

  app.get<{ Params: { id: string } }>('/internal/v1/ledger/:id', async (request) => ({ job_id: request.params.id }));

  app.get<{ Params: { id: string } }>('/internal/v1/pages/:id', async (request, reply) => {
    if (scenario.mode === 'ok') {
      const payload = okPayload(request.params.id) as { job: { page: unknown } };
      return { job_id: request.params.id, status: 'COMPLETED', page: payload.job.page, page_validation: { valid: true }, build_issues: [] };
    }
    reply.status(404).send({ detail: 'job not found in in-memory store' });
    return reply;
  });

  // Stage 6 ephemeral asset store (Phase 16). Serves the fake bytes when the
  // scenario asked for assets and the bytes weren't marked missing.
  app.get<{ Params: { jobId: string; ref: string } }>('/internal/v1/assets/:jobId/:ref', async (_request, reply) => {
    if (scenario.assets === true && scenario.assetsMissing !== true) {
      return reply.type('image/png').send(Buffer.from('fakepngbytes'));
    }
    reply.status(404).send({ detail: 'asset not found in the ephemeral store' });
    return reply;
  });

  return {
    app,
    scenario,
    calls,
    paths,
    setScenario(s: Scenario) {
      this.scenario.mode = s.mode;
      this.scenario.transientRemaining = s.transientRemaining;
      this.scenario.delayMs = s.delayMs;
      this.scenario.assets = s.assets;
      this.scenario.assetsMissing = s.assetsMissing;
    },
    async start(): Promise<string> {
      await app.listen({ host: '127.0.0.1', port: 0 });
      const address = app.server.address() as AddressInfo;
      return `http://127.0.0.1:${address.port}`;
    },
    async stop(): Promise<void> {
      await app.close();
    },
  };
}
