import { createDatabase, runMigrations } from '@klockr/db';
import { fileURLToPath } from 'node:url';

/**
 * One-shot migration entrypoint for deployments (`node dist/migrate.js`), run as its own
 * container before server and worker start. Uses the real Drizzle migrations that the build
 * copies next to the bundle (see tsup.config.ts). Applies only pending migrations; never resets.
 * A non-zero exit code blocks the dependent services.
 */
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required for migrations.');
  process.exit(1);
}

const handle = createDatabase(url);
try {
  await runMigrations(handle, fileURLToPath(new URL('./migrations', import.meta.url)));
  console.log('Migrations applied.');
} catch (error) {
  console.error('Migration failed:', error);
  process.exitCode = 1;
} finally {
  await handle.close();
}
