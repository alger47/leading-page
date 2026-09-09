# ADR-0004: Worker & Job Orchestration — BullMQ over Redis with a Port Adapter

- **Status:** Accepted (2026-09-09, worker phase)
- **Relates to:** PART X §10 (GenerationJob states, §11 API contract), master catalog "Phase 5 role: Worker & job orchestration"

## Context

The platform needs an async job tier between the public API and the AI engine
(§10.1): `POST /api/jobs` returns `202 + { jobId }` immediately, a worker drains
the queue, calls the engine's synchronous `/internal/v1/generate`, records
stable lifecycle events (§11.4), retries transient engine failures with
backoff, honours budgets/refusals, and exposes status/events/telemetry.

Constraints discovered while bring-up this phase:

1. **ioredis-mock cannot run BullMQ Lua scripts.** BullMQ persists jobs via
   Lua (`addStandardJob` uses `cmsgpack`); ioredis-mock's fengari sandbox
   lacks `cmsgpack` (`attempt to index a nil value (global 'cmsgpack')`).
   Redis itself is not installed on the dev machine and is not guaranteed in
   CI, so the whole suite can no longer depend on a live Redis.
2. The engine call is **synchronous HTTP**: `/internal/v1/generate` returns the
   completed job (or a FAILED envelope) in one response. There is no job → stage
   streaming, so per-stage `stage.*` events are synthesized post-hoc from the
   returned payload's `stages` ledger by a stable stage→event map.
3. The job store is in-memory until the persistence phase (§11.x), which bounds
   the idempotency guarantee to a single worker process lifetime.

## Decision

**Production queue stays BullMQ over Redis; the worker code depends on small
port interfaces instead of BullMQ types, and tests drive an in-memory driver
that emulates BullMQ's semantics** (`src/queue/ports.ts`,
`src/queue/bullmq.ts`, `src/queue/memory.ts`).

- `EnqueueDriver<T>`: `{ name, add(data, {jobId}), remove(id), close() }`.
  Added de-duplicate by `jobId` (BullMQ semantics). `remove()` backs the
  `DELETE /api/jobs/:id` cancel.
- `JobLike`: `{ id, data, attemptsMade, moveToFailed(err, token) }` — the only
  surface the processor touches. `startBullWorker` adapts BullMQ `Job` to it;
  the memory driver constructs it directly.
- The processor (`src/processor.ts`) therefore has **no BullMQ imports** and is
  identical under both drivers. Retry/backoff/exhaustion are emulated by
  `makeMemoryDriver` (exponential backoff, `maxAttempts`, `onFailed` on
  exhaustion → `E-JOB-001`), so the failure-injection tests exercise real
  processor code paths offline.
- `tests/real-bullmq.integration.test.ts` guards the **real** BullMQ stack and
  self-skips when `REDIS_URL` is unreachable (no docker dependency in CI).

Other decisions:

- `job_id` sent to the engine is the worker's job id (`gen_<sha256(key)[0:24]>`,
  derived from the Idempotency-Key/derived fingerprint). The engine echoes it
  back; `/internal/v1/pages/{job_id}` and `/ledger/{job_id}` are thus reachable
  from the job view.
- Stable events (§11.4): `job.queued → job.started → stage.* (mapped set) →
  job.completed | job.failed {code} | job.cancelled`. Engine stages
  `persona-builder`/`layout-planner`/`asset-planner` map to **no** stable event by
  design; `schema-builder`→`stage.schema_built`, `page-validator`→`stage.validated`.
  Note: the real engine only stage-tracks its 5 sub-generation steps, so the
  exact emitted `stage.*` set is contract-driven, not issuer-driven.
- Error codes: `E-JOB-001` transient exhausted, `E-JOB-002` idempotency
  conflict (422), `E-JOB-003` cancelled (409 on terminal), `E-JOB-004` malformed
  engine envelope (no retry), `E-JOB-005` crash recovery (stalled re-run).
  Engine 5xx/timeouts are retried by the queue; 4xx business refusals and
  `job.status == FAILED` are terminal (`attempts` never advance past 1).
- Crash recovery: an interrupted `RUNNING` record is re-processed in place with
  a `job.retried {code: E-JOB-005}` event; history is otherwise not durable
  until the persistence phase.

## Rationale

- BullMQ gives us the §10 production semantics (locks, stalled detection,
  exponential backoff, `removeOnComplete/Fail` retention) without re-implementing
  a queue; the in-memory driver keeps the acceptance suite (integration tests
  with a stubbed engine) runnable in any environment.
- Port-typed dependencies (over BullMQ types directly) is why the mock-Redis
  failure didn't leak into the processor/API layers and why the switch was a
  drop-in for existing tests.
- Deriving the engine `job_id` from the idempotency key makes replay safe: the
  same key always addresses the same engine job artefact.

## Consequences

### Positive
- Full lifecycle (enqueue → process → retry → complete/fail/cancel) is tested
  deterministically offline (16 unit + real-engine e2e) with zero Redis.
- Retry/exhaustion/business/malformed/timeout/cancel semantics are pinned by
  tests at the processor level, not at the queue level.
- The optional real-BullMQ test proves the adapter when Redis is reachable.

### Negative
- The in-memory driver is a subset of BullMQ semantics (dedupe, backoff,
  exhaustion); details like stalled-job re-delivery timing are only honoured by
  the real adapter, and only exercised when the optional test runs.
- Idempotency/`E-JOB-002` hold within one process only; multi-instance awaits
  the database phase.
- `E-JOB-005` recovery re-runs an interrupted job from scratch (no checkpointing
  yet); acceptable while engine calls are idempotent by job id.

### Mitigations
- Keep `tests/real-bullmq.integration.test.ts` to prove the BullMQ path when a
  local Redis is present (`docker run -p 6379:6379 redis:7`).
- The engine re-running the same `job_id` produces a deterministic (stub) or
  shared-ledger result, so replays converge on the same page.

## References
- PART X §10.1–§10.2 (job states QUEUED→RUNNING→VALIDATING→RENDERING→COMPLETED;
  reserved states documented), §11.1 (Idempotency-Key), §11.4 (stable events)
- docs/walkthrough.md (Phase 6), docs/ai-pipeline.md §6 (HTTP API)
- `apps/worker/README.md`