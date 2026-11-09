import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { DatabaseHandle } from './client';

/** Default location in the source tree; bundled apps pass their own copied folder. */
export const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

/** Apply all pending migrations. Safe to run repeatedly. */
export async function runMigrations(
  handle: DatabaseHandle,
  folder = migrationsFolder,
): Promise<void> {
  await migrate(handle.db, { migrationsFolder: folder });
}
