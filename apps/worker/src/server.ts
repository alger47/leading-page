import { timingSafeEqual } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';

import { registerRoutes, type WorkerContext } from './routes.js';

/** Constant-time token comparison (never leaks length differences in timing). */
function tokensEqual(provided: string, expected: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function buildServer(ctx: WorkerContext): FastifyInstance {
  const app = Fastify({ logger: false });

  // Internal API auth (F3): every route except /healthz requires the shared
  // X-Internal-Token, mirroring the AI engine's own auth (deps.py). Healthz
  // stays public so load balancers / k8s probes can reach it.
  app.addHook('onRequest', async (request, reply) => {
    const pathname = request.url.split('?')[0];
    if (pathname === '/healthz') return;
    const provided = request.headers['x-internal-token'];
    const expected = ctx.config.apiToken;
    if (typeof provided !== 'string' || !tokensEqual(provided, expected)) {
      return reply.status(401).send({
        error: { code: 'E-AUTH-001', message: 'missing or invalid internal token', docs: '/docs/errors/E-AUTH-001' },
      });
    }
  });

  registerRoutes(app, ctx);
  return app;
}