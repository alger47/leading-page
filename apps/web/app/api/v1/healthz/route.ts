import { getPrismaClient } from '@landing-ai/database';
import { jsonOk } from '@/lib/api';
import { webConfig } from '@/lib/env';

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
  return jsonOk({ status, service: 'web', db, worker });
}