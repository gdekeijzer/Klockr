import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDatabase, pingDatabase } from './client';
import { runMigrations } from './migrate';
import { systemMeta } from './schema';

const url = process.env.DATABASE_URL ?? 'postgres://klockr:klockr@localhost:54329/klockr_dev';
const handle = createDatabase(url);

afterAll(async () => {
  await handle.close();
});

describe('database migrations (requires PostgreSQL)', () => {
  it('connects', async () => {
    expect(await pingDatabase(handle)).toBe(true);
  });

  it('applies migrations idempotently and the bootstrap table is usable', async () => {
    await runMigrations(handle);
    await runMigrations(handle);

    await handle.db
      .insert(systemMeta)
      .values({ key: 'm0.bootstrap', value: 'ok' })
      .onConflictDoUpdate({ target: systemMeta.key, set: { value: 'ok', updatedAt: new Date() } });
    const rows = await handle.db
      .select()
      .from(systemMeta)
      .where(eq(systemMeta.key, 'm0.bootstrap'));
    expect(rows[0]?.value).toBe('ok');
  });
});
