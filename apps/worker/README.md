# @landing-ai/worker

Job orchestration tier for the landing-page platform: public API → queue →
AI engine, with retries, idempotency, stable lifecycle events and telemetry
(ADR-0004).

## Layout

```
src/
  config.ts          env config (PORT, AI_ENGINE_URL, AI_INTERNAL_TOKEN, QUEUE_NAME,
                     REDIS_URL, ENGINE_TIMEOUT_MS, MAX_ATTEMPTS, RETRY_AFTER_MS)
  engine/client.ts   typed HTTP client for /internal/v1/generate (+ healthz)
  engine/types.ts    engine envelope (job, stages, ledger, validation, page…)
  jobs/types.ts      job domain: statuses, stable events (§11.4), E-JOB-0xx codes
  jobs/enqueue.ts    idempotent enqueue (Idempotency-Key or derived fingerprint),
                     job id gen_<sha256(key)[0:24]>, E-JOB-002 conflicts
  queue/ports.ts     EnqueueDriver / JobLike / WorkerHandle (implementation-free)
  queue/bullmq.ts    production adapters over BullMQ + ioredis (real Redis)
  queue/memory.ts    in-memory driver for tests (dedupe, backoff, exhaustion)
  processor.ts       web → queue → engine; crash recovery E-JOB-005, terminal
                     failures E-JOB-00x, per-trace spans
  routes.ts          fastify API (POST/GET/DELETE /api/jobs, /events, /spans, /healthz)
  store.ts           MemoryJobStore (id + idempotency-key indexes)
  span store         telemetry.ts (in-memory spans; exported via /api/jobs/:id/spans)
  server.ts / index.ts  fastify bootstrap + graceful shutdown
```

## API

- `POST /api/jobs` — `{ brief, locale?, tone?, budgetUsd? }` +
  `Idempotency-Key` header → `202 { jobId }` (new) or `200` (replay);
  same key + different payload → `422 E-JOB-002`.
- `GET /api/jobs/:id` — status, attempts, engine refs, error, result.
- `GET /api/jobs/:id/events` — stable event list.
- `GET /api/jobs/:id/spans` — job.process → engine.generate trace.
- `DELETE /api/jobs/:id` — cancel (queued → `E-JOB-003`); `409` if terminal.
- `GET /healthz` — liveness + engine reachability.

Errors are envelopes: `{ error: { code, message, details?, docs } }`.

## Run (needs Redis + the engine)

```bash
pnpm dev            # tsx, reads .env (copy .env.example)
pnpm start          # compiled dist
```

```bash
docker run -p 6379:6379 redis:7
# engine: apps/ai-engine, `.venv\Scripts\python -m uvicorn app.main:app --port 8000`
```

Worker default env: `AI_ENGINE_URL=http://127.0.0.1:8000`, token must match the
engine (`AI_INTERNAL_TOKEN`), `QUEUE_NAME=jobs`, `MAX_ATTEMPTS=3`.

## Tests

```bash
pnpm test                    # 16 unit/integration tests over the in-memory driver (no Redis)
pnpm test:integration        # real-engine e2e (spawns uvicorn from apps/ai-engine/.venv,
                             # skips if venv missing) + real-BullMQ e2e (skips if no Redis)
pnpm typecheck && pnpm build
```

The in-memory driver exercises the real processor (retries, backoff, exhaustion,
business failures, cancellation) deterministically; the real-engine suite proves
the worker ↔ engine HTTP contract end to end (stub provider).