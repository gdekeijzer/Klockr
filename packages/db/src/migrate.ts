import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { DatabaseHandle } from './client';

export const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

/** Apply all pending migrations. Safe to run repeatedly. */
export async function runMigrations(handle: DatabaseHandle): Promise<void> {
  await migrate(handle.db, { migrationsFolder });
}
