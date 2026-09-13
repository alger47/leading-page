import { readFileSync } from 'node:fs';
import { getPrismaClient } from '@landing-ai/database';
import { jsonOk } from '@/lib/api';
import { webConfig } from '@/lib/env';

function procEnviron(): Record<string, string> | null {
  try {
    const raw = readFileSync('/proc/1/environ', 'latin1');
    const out: Record<string, string> = {};
    for (const pair of raw.split('\0')) {
      const idx = pair.indexOf('=');
      if (idx > 0) out[pair.slice(0, idx)] = pair.slice(idx + 1);
    }
    return out;
  } catch {
    return null;
  }
}

export async function GET() {
  const cfg = webConfig();
  let db = 'ok';
  let worker = cfg.workerUrl;
  try {
    await getPrismaClient().$queryRaw`SELECT 1`;
  } catch {
    db = 'error';
  }
  const procEnv = procEnviron();
  const probeKeys = ['WORKER_URL', 'DATABASE_URL', 'WORKER_INTERNAL_TOKEN'];
  const status = db === 'ok' ? 'ok' : 'degraded';
  return jsonOk({
    status,
    service: 'web',
    db,
    worker,
    envProbe: {
      nodeEnv: process.env.NODE_ENV,
      hasWorkerUrl: typeof process.env.WORKER_URL === 'string' && process.env.WORKER_URL.length > 0,
      hasDatabaseUrl: typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.length > 0,
      presentKeysInProcess: probeKeys.filter((k) => process.env[k] !== undefined),
      procEnvironAvailable: procEnv !== null,
      presentKeysInPid1: probeKeys.filter((k) => procEnv?.[k] !== undefined),
    },
  });
}