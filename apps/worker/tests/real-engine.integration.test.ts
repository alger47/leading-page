/**
 * End-to-end against the REAL ai-engine service (stub provider). This is the
 * "integration tests with stubbed engine" acceptance: the worker hands a real
 * job to the engine HTTP contract and the assembled page comes back valid.
 *
 * Requires the engine venv to exist (apps/ai-engine/.venv). Skipped otherwise.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { makeHarness, waitFor } from './harness.js';

const ENGINE_DIR = fileURLToPath(new URL('../../ai-engine', import.meta.url));
const WIN_VENV = `${ENGINE_DIR}/.venv/Scripts/python.exe`;
const NIX_VENV = `${ENGINE_DIR}/.venv/bin/python`;
const PYTHON = existsSync(WIN_VENV) ? WIN_VENV : existsSync(NIX_VENV) ? NIX_VENV : undefined;

const PORT = 18_000 + Math.floor(Math.random() * 1_000);
const BASE = `http://127.0.0.1:${PORT}`;

let child: ChildProcess | undefined;
let exitCode: number | null = null;

async function waitForHealthz(timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (exitCode !== null) throw new Error(`ai-engine exited early with code ${exitCode}`);
    if (Date.now() > deadline) throw new Error('ai-engine did not become healthy in time');
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.status === 200) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

afterAll(async () => {
  if (child !== undefined) {
    child.kill();
  }
});

if (PYTHON === undefined) {
  describe('worker -> real ai-engine (stub provider)', () => {
    it('is skipped when the engine venv is missing', () => {
      expect(PYTHON).toBeUndefined();
    });
  });
} else {
  describe('worker -> real ai-engine (stub provider)', () => {
    it('runs a full generation job and returns a validated page', async () => {
      child = spawn(PYTHON, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(PORT), '--log-level', 'warning'], {
        cwd: ENGINE_DIR,
        stdio: 'ignore',
        env: { ...process.env, AI_PROVIDER: 'stub', AI_INTERNAL_TOKEN: 'test-token', AI_ENV: 'test' },
      });
      child.on('exit', (code) => {
        exitCode = code;
      });

      await waitForHealthz();

      const h = await makeHarness({ engineBaseOverride: BASE, queueName: `e2e-${Math.random().toString(36).slice(2, 8)}` });
      try {
        const brief = 'عيادة بيطرية حديثة في الجزائر العاصمة: مواعيد دقيقة، رعاية القطط والكلاب، فريق اختصاصيين.';
        const created = await h.app.inject({
          method: 'POST',
          url: '/api/jobs',
          headers: { 'content-type': 'application/json', 'idempotency-key': `real-engine-${Date.now()}` },
          payload: JSON.stringify({ brief, locale: 'ar', tone: 'warm-professional', budgetUsd: 0.25 }),
        });
        expect(created.statusCode).toBe(202);
        const jobId = created.json<{ jobId: string }>().jobId;

        await h.resumeWorker();
        await waitFor(async () => h.store.get(jobId)?.status === 'COMPLETED', 120_000);

        const record = h.store.get(jobId)!;
        expect(record.status).toBe('COMPLETED');
        expect(record.engineJobId).toBe(jobId); // worker passes its own job_id to the engine

        const result = record.result!;
        expect(result.status).toBe('COMPLETED');
        expect(result.ledger.attempts).toBeGreaterThanOrEqual(1);
        expect(result.page).toBeDefined();
        const page = result.page as { schemaVersion: string };
        expect(page.schemaVersion).toBe('1.0.0');
        expect(result.page_validation).toEqual(
          expect.objectContaining({ valid: true }),
        );

        // The real engine only stage-tracks its sub-generation steps
        // (validate/schema build are internal to it), so assert the stable
        // framing (queued -> started -> ... -> completed) plus the stages it
        // does report, in order, rather than a fixed list.
        const events = record.events;
        const eventTypes = events.map((e) => e.type);
        expect(eventTypes[0]).toBe('job.queued');
        expect(eventTypes[1]).toBe('job.started');
        expect(eventTypes[eventTypes.length - 1]).toBe('job.completed');
        expect(eventTypes).not.toContain('job.failed');
        const stageTypes = eventTypes.slice(2, -1).filter((t) => t.startsWith('stage.'));
        expect(stageTypes).toContain('stage.brief_analyzed');
        expect(stageTypes).toContain('stage.page_planned');
        expect(stageTypes).toContain('stage.content_generated');
      } finally {
        await h.close();
      }
    }, 120_000);

    it('regenerates a single section (mode=section) against the real engine', async () => {
      const h = await makeHarness({ engineBaseOverride: BASE, queueName: `e2e-regen-${Math.random().toString(36).slice(2, 8)}` });
      try {
        // 1. Full generation to obtain a page document.
        const brief = 'عيادة بيطرية حديثة في الجزائر العاصمة: مواعيد دقيقة، رعاية القطط والكلاب، فريق اختصاصيين.';
        const created = await h.app.inject({
          method: 'POST',
          url: '/api/jobs',
          headers: { 'content-type': 'application/json', 'idempotency-key': `real-engine-full-${Date.now()}` },
          payload: JSON.stringify({ brief, locale: 'ar', tone: 'warm-professional', budgetUsd: 0.25 }),
        });
        expect(created.statusCode).toBe(202);
        const fullJobId = created.json<{ jobId: string }>().jobId;
        await h.resumeWorker();
        await waitFor(async () => h.store.get(fullJobId)?.status === 'COMPLETED', 120_000);
        const page = (h.store.get(fullJobId)!.result!.page as { sections: Array<{ id: string; type: string; content: Record<string, unknown> }> });
        const heroId = page.sections.find((s) => s.type === 'hero')!.id;

        // 2. Section regeneration over that page.
        const regen = await h.app.inject({
          method: 'POST',
          url: '/api/jobs',
          headers: { 'content-type': 'application/json', 'idempotency-key': `real-engine-regen-${Date.now()}` },
          payload: JSON.stringify({ brief, mode: 'section', targetSectionId: heroId, page, locale: 'ar', tone: 'warm-professional', budgetUsd: 0.05 }),
        });
        expect(regen.statusCode).toBe(202);
        const regenJobId = regen.json<{ jobId: string }>().jobId;
        await waitFor(async () => {
          const rec = h.store.get(regenJobId);
          if (rec?.status === 'FAILED') {
            // eslint-disable-next-line no-console
            console.error('REAL-ENGINE REGEN FAILED:', rec.errorCode, rec.errorMessage);
          }
          return rec?.status === 'COMPLETED';
        }, 120_000);

        const record = h.store.get(regenJobId)!;
        expect(record.status).toBe('COMPLETED');
        const result = record.result!;
        expect(result.page_validation).toEqual(expect.objectContaining({ valid: true }));
        const spliced = result.page as { sections: Array<{ id: string; type: string; content: Record<string, unknown> }> };
        expect(spliced.sections.map((s) => s.id)).toEqual(page.sections.map((s) => s.id));
        // Every section except the target must be byte-identical.
        for (let i = 0; i < page.sections.length; i += 1) {
          if (page.sections[i].id === heroId) continue;
          expect(spliced.sections[i]).toEqual(page.sections[i]);
        }
        const heroAfter = spliced.sections.find((s) => s.id === heroId)!;
        expect(heroAfter.type).toBe('hero');
      } finally {
        await h.close();
      }
    }, 120_000);
  });
}