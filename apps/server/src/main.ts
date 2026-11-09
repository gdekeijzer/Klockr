import { createDatabase, pingDatabase } from '@klockr/db';
import { buildApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const database = config.DATABASE_URL ? createDatabase(config.DATABASE_URL) : null;

const app = buildApp({
  version: config.KLOCKR_VERSION,
  logLevel: config.LOG_LEVEL,
  ...(database ? { checkDatabase: () => pingDatabase(database) } : {}),
});

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await database?.close();
  process.exit(0);
}

process.once('SIGINT', (s) => void shutdown(s));
process.once('SIGTERM', (s) => void shutdown(s));

try {
  await app.listen({ host: config.SERVER_HOST, port: config.SERVER_PORT });
} catch (error) {
  app.log.fatal(error, 'failed to start');
  process.exit(1);
}
