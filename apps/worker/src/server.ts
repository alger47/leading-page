import Fastify, { type FastifyInstance } from 'fastify';

import { registerRoutes, type WorkerContext } from './routes.js';

export function buildServer(ctx: WorkerContext): FastifyInstance {
  const app = Fastify({ logger: false });
  registerRoutes(app, ctx);
  return app;
}