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
  return jsonOk({
    status,
    service: 'web',
    db,
    worker,
    envProbe: {
      hasWorkerUrl: typeof process.env.WORKER_URL === 'string' && process.env.WORKER_URL.length > 0,
      workerUrlRaw: process.env.WORKER_URL,
      hasDatabaseUrl: typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.length > 0,
      databaseUrlPrefix: (process.env.DATABASE_URL ?? '')
        .replace(/:[^:@]*@/, ':*****@')
        .slice(0, 60),
      nodeEnv: process.env.NODE_ENV,
    },
  });
}