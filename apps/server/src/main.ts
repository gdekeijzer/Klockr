import {
  createDatabase,
  PgIdempotencyStore,
  PgShowStore,
  pingDatabase,
  runMigrations,
} from '@klockr/db';
import { systemClock } from '@klockr/domain';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app';
import { loadConfig } from './config';
import { RealtimeHub } from './realtime/hub';
import { attachRealtime } from './realtime/socket';
import { createServices } from './services';

const config = loadConfig();
if (!config.DATABASE_URL) {
  console.error('DATABASE_URL is required: Shows must survive a server restart.');
  process.exit(1);
}

const database = createDatabase(config.DATABASE_URL);
// The build copies packages/db/migrations next to the bundle (see tsup.config.ts).
if (config.MIGRATE_ON_START) {
  await runMigrations(database, fileURLToPath(new URL('./migrations', import.meta.url)));
}

const hub = new RealtimeHub(systemClock);
const services = createServices({
  clock: systemClock,
  events: hub,
  persistence: {
    store: new PgShowStore(database.db),
    idempotency: new PgIdempotencyStore(database.db),
  },
});

const app = await buildApp({
  version: config.KLOCKR_VERSION,
  logLevel: config.LOG_LEVEL,
  services,
  secureCookies: config.COOKIE_SECURE,
  checkDatabase: () => pingDatabase(database),
});
const io = attachRealtime(app.server, services, hub, app.log);

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  await io.close();
  await app.close();
  await database.close();
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
app.log.info(
  { publicUrl: config.KLOCKR_PUBLIC_URL ?? null, secureCookies: config.COOKIE_SECURE },
  'configuration',
);
