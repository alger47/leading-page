import { getPrismaClient } from '@landing-ai/database';
import { jsonOk } from '@/lib/api';
import { webConfig } from '@/lib/env';

// Route reads runtime process env; without dynamic it would be prerendered
// as static during `next build` (GET route handlers default to static).
export const dynamic = 'force-dynamic';

export async function GET() {
  const cfg = webConfig();
  let db = 'ok';
  let worker = cfg.workerUrl;
  try {
    await getPrismaClient().$queryRaw`SELECT 1`;
  } catch {
    db = 'error';
  }
  const status = db === 'ok' ? 'ok' : 'degraded';
  // Phase 14 (§12 security): the endpoint is unauthenticated, so it must not
  // disclose process/PID-1 environment presence (previously probed
  // WORKER_URL / DATABASE_URL / WORKER_INTERNAL_TOKEN) — presence alone leaks
  // which secrets exist and the internal service topology.
  return jsonOk({
    status,
    service: 'web',
    db,
    worker,
  });
}