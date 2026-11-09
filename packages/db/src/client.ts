import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseHandle {
  readonly db: Database;
  readonly pool: pg.Pool;
  close(): Promise<void>;
}

export function createDatabase(connectionString: string): DatabaseHandle {
  const pool = new pg.Pool({ connectionString, max: 10 });
  const db = drizzle(pool, { schema });
  // `pool.end()` resolves once the pool has released its clients, before their connections are
  // actually closed. Track open clients so `close()` returns only when every connection ended
  // (callers may then safely drop or restart the database).
  const open = new Set<pg.PoolClient>();
  pool.on('connect', (client) => {
    open.add(client);
    client.once('end', () => {
      open.delete(client);
    });
  });
  const close = async () => {
    const closing = [...open].map(
      (client) =>
        new Promise<void>((resolve) => {
          client.once('end', () => {
            resolve();
          });
        }),
    );
    await pool.end();
    await Promise.all(closing);
  };
  return { db, pool, close };
}

/** Lightweight readiness probe. */
export async function pingDatabase(handle: DatabaseHandle): Promise<boolean> {
  try {
    await handle.pool.query('select 1');
    return true;
  } catch {
    return false;
  }
}
