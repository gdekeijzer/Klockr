import { setTimeout as delay } from 'node:timers/promises';
import { systemClock } from '@klockr/domain';
import pino from 'pino';
import { loadConfig } from './config';
import { jobs, runJobsOnce } from './jobs';

const config = loadConfig();
const logger = pino({
  level: config.LOG_LEVEL,
  base: { service: 'worker', version: config.KLOCKR_VERSION },
});
const controller = new AbortController();

function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down');
  controller.abort();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

logger.info(
  { jobs: jobs.map((j) => j.name), intervalMs: config.WORKER_INTERVAL_MS },
  'worker started',
);

while (!controller.signal.aborted) {
  const reports = await runJobsOnce(jobs, systemClock, logger, controller.signal);
  logger.debug({ reports }, 'job cycle complete');
  try {
    await delay(config.WORKER_INTERVAL_MS, undefined, { signal: controller.signal });
  } catch {
    // Aborted during the wait: exit the loop.
  }
}

logger.info('worker stopped');
