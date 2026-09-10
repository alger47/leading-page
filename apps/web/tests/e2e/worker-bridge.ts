/**
 * J1 e2e bridge: wires the REAL worker pipeline (API server + processor +
 * in-memory driver) to the REAL ai-engine process in one test process, then
 * serves the worker HTTP API on an ephemeral port so the web's production
 * HttpWorkerClient talks to it over real HTTP. No fake job states anywhere —
 * the only substitution is Redis's queue transport (in-memory driver), which
 * is the repo's established no-Docker e2e seam (see worker's harness).
 *
 * This file imports worker sources not visible to the web tsconfig, so it is
 * typechecked as part of apps/worker; the web tsconfig excludes `tests/**​/*.e2e.ts`.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { type AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

import { buildServer } from '../../../../apps/worker/src/server';
import type { WorkerConfig } from '../../../../apps/worker/src/config';
import { EngineClient } from '../../../../apps/worker/src/engine/client';
import { makeProcessor } from '../../../../apps/worker/src/processor';
import type { JobPayload } from '../../../../apps/worker/src/jobs/types';
import { makeMemoryDriver } from '../../../../apps/worker/src/queue/memory';
import { MemoryJobStore } from '../../../../apps/worker/src/store';
import { MemorySpanStore } from '../../../../apps/worker/src/telemetry';
import type { FastifyInstance } from 'fastify';

const appsRoot = fileURLToPath(new URL('../../..', import.meta.url)); // apps/
const ENGINE_DIR = `${appsRoot}/ai-engine`;
const WIN_VENV = `${ENGINE_DIR}/.venv/Scripts/python.exe`;
const NIX_VENV = `${ENGINE_DIR}/.venv/bin/python`;
const PYTHON = existsSync(WIN_VENV) ? WIN_VENV : existsSync(NIX_VENV) ? NIX_VENV : undefined;

export interface RealWorkerBridge {
  /** Base URL of the real worker HTTP API (production HttpWorkerClient target). */
  workerBaseUrl: string;
  enginePid: number | null;
  /** Start processing. Call after the web has enqueued (see memory-driver write race). */
  resume(): Promise<void>;
  close(): Promise<void>;
}

/** Shared worker API token between the bridge server and the web client. */
export const WORKER_TOKEN = 'test-worker-token';

export function engineVenvAvailable(): boolean {
  return PYTHON !== undefined;
}

/** Boot the real ai-engine (stub provider) and the real worker pipeline. */
export async function startRealWorkerBridge(): Promise<RealWorkerBridge> {
  if (PYTHON === undefined) throw new Error('ai-engine venv missing');

  const enginePort = 18_000 + Math.floor(Math.random() * 1_000);
  const engineBase = `http://127.0.0.1:${enginePort}`;

  const child: ChildProcess = spawn(
    PYTHON,
    ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(enginePort), '--log-level', 'warning'],
    { cwd: ENGINE_DIR, stdio: 'ignore', env: { ...process.env, AI_PROVIDER: 'stub', AI_INTERNAL_TOKEN: 'test-token', AI_ENV: 'test' } },
  );
  await waitForHealthz(engineBase, child);

  const queueName = `j1-${Math.random().toString(36).slice(2, 8)}`;
  const store = new MemoryJobStore();
  const spans = new MemorySpanStore();
  const engine = new EngineClient({ baseUrl: engineBase, token: 'test-token', timeoutMs: 60_000 });
  const processor = makeProcessor({ engine, store, spans });
  const driver = makeMemoryDriver<JobPayload>(queueName, {
    maxAttempts: 3,
    retryAfterMs: 25,
    // Paused until resume(): the memory driver drains on add(), but the
    // worker enqueue route store.put()s the QUEUED record AFTER add() resolves.
    // Processing immediately would race that write and clobber the progress
    // stores (the same reason the worker harness resumes post-enqueue).
    startPaused: true,
    processor: (job, token) => processor.run(job, token),
    onFailed: (id, error) => void processor.finalizeFailure(id, error),
  });

  const config: WorkerConfig = {
    port: 0,
    engineUrl: engineBase,
    engineToken: 'test-token',
    apiToken: WORKER_TOKEN,
    queueName,
    redisUrl: 'redis://memory',
    engineTimeoutMs: 60_000,
    maxAttempts: 3,
    retryAfterMs: 25,
  };

  const app: FastifyInstance = buildServer({ store, spans, queue: driver.queue, engine, config });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address() as AddressInfo;
  const workerBaseUrl = `http://127.0.0.1:${address.port}`;

  return {
    workerBaseUrl,
    enginePid: child.pid ?? null,
    async resume() {
      await driver.worker.resume();
    },
    async close() {
      await driver.worker.close();
      await app.close();
      child.kill();
    },
  };
}

export async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 120_000, intervalMs = 250): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) return;
    if (Date.now() > deadline) throw new Error('condition not met within timeout');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function waitForHealthz(base: string, child: ChildProcess, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`ai-engine exited early with code ${child.exitCode}`);
    if (Date.now() > deadline) throw new Error('ai-engine did not become healthy in time');
    try {
      const res = await fetch(`${base}/healthz`);
      if (res.status === 200) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}