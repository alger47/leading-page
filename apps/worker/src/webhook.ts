/**
 * RT ج — background finalize webhook.
 *
 * The web only finalizes a job (persists PageVersion + generated rasters)
 * inside GenerationService.liveSync(), which is triggered by BROWSER polling.
 * If the user closes the tab right after the worker completes, the DB job
 * stays non-terminal and the version/raster data is never persisted. This
 * module closes that gap: when the worker marks a job terminal it POSTs a
 * small notification to the web's internal finalize route, so the DB is
 * reconciled without waiting for a browser poll.
 *
 * Contract: POST $webBase/api/internal/jobs/:jobId/notify  (X-Internal-Token)
 *   body: { status: 'COMPLETED' | 'FAILED' | 'CANCELLED' }
 * The web route is idempotent (the finalize path is guarded by DB transitions
 * + runExclusive), so replays / races are harmless. Best-effort by design: a
 * failed webhook never fails the job — the next browser poll still reconciles.
 */

export type TerminalStatus = 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface WebhookNotifier {
  /** Fire-and-forget with a single retry; never throws. */
  notify(jobId: string, status: TerminalStatus): Promise<void>;
}

interface WebhookDeps {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function createWebhookNotifier(deps: WebhookDeps): WebhookNotifier {
  const base = deps.baseUrl;
  const token = deps.token;
  const timeoutMs = deps.timeoutMs ?? 5_000;
  const fetchImpl = deps.fetchImpl ?? fetch;

  async function sendOnce(url: string, status: TerminalStatus): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-token': token },
        body: JSON.stringify({ status }),
        signal: controller.signal,
      });
      return res.status >= 200 && res.status < 300;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async notify(jobId: string, status: TerminalStatus): Promise<void> {
      const url = `${base}/api/internal/jobs/${encodeURIComponent(jobId)}/notify`;
      // One immediate attempt + one retry after 100ms: covers a momentarily
      // unhealthy web instance without ever stalling job processing. On total
      // failure the notification is preserved for the next browser poll, which
      // runs the same idempotent finalize — honest reconciliation either way.
      if (await sendOnce(url, status)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
      await sendOnce(url, status);
    },
  };
}