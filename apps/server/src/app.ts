import type { ShowServiceDeps } from '@klockr/application';
import type { HealthResponse } from '@klockr/contracts';
import { systemClock, type Clock } from '@klockr/domain';
import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerApiRoutes } from './http/routes';

export interface AppOptions {
  readonly version: string;
  readonly logLevel?: string;
  readonly clock?: Clock;
  /** Readiness probe for PostgreSQL; omitted when no database is configured. */
  readonly checkDatabase?: () => Promise<boolean>;
  /** Application services; when omitted only health endpoints are served. */
  readonly services?: ShowServiceDeps;
  readonly secureCookies?: boolean;
}

/**
 * Builds the Fastify app. Routes stay thin: they validate input with @klockr/contracts and call
 * @klockr/application use cases.
 */
export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const clock = options.clock ?? systemClock;
  const app = Fastify({
    logger: {
      level: options.logLevel ?? 'info',
      // Never log credentials (owner cookies, board bearer tokens).
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
    },
    // Behind the reverse proxy / Next rewrites; client IP for rate limiting comes from it.
    trustProxy: true,
    bodyLimit: 16 * 1024,
  });

  app.get('/health', (): HealthResponse => ({
    status: 'ok',
    service: 'server',
    version: options.version,
    time: new Date(clock.now()).toISOString(),
  }));

  app.get('/health/ready', async (_request, reply): Promise<HealthResponse> => {
    const database = options.checkDatabase
      ? (await options.checkDatabase())
        ? 'ok'
        : 'fail'
      : 'skipped';
    const status = database === 'fail' ? 'degraded' : 'ok';
    if (status !== 'ok') reply.code(503);
    return {
      status,
      service: 'server',
      version: options.version,
      time: new Date(clock.now()).toISOString(),
      checks: { database },
    };
  });

  if (options.services) {
    await app.register(fastifyCookie);
    await app.register(fastifyRateLimit, { global: false });
    registerApiRoutes(app, {
      services: options.services,
      secureCookies: options.secureCookies ?? false,
    });
  }

  return app;
}
