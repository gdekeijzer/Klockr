import type { HealthResponse } from '@klockr/contracts';
import { systemClock, type Clock } from '@klockr/domain';
import Fastify, { type FastifyInstance } from 'fastify';

export interface AppOptions {
  readonly version: string;
  readonly logLevel?: string;
  readonly clock?: Clock;
  /** Readiness probe for PostgreSQL; omitted when no database is configured. */
  readonly checkDatabase?: () => Promise<boolean>;
}

/**
 * Builds the Fastify app. Routes stay thin: they validate input with @klockr/contracts and call
 * @klockr/application commands. M0 exposes health endpoints only.
 */
export function buildApp(options: AppOptions): FastifyInstance {
  const clock = options.clock ?? systemClock;
  const app = Fastify({
    logger: { level: options.logLevel ?? 'info' },
    disableRequestLogging: false,
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

  return app;
}
