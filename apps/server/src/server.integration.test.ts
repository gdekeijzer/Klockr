import { createDatabase, PgIdempotencyStore, PgShowStore, runMigrations } from '@klockr/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookieFrom, nextEvent, startTestServer } from './testing/harness';

const url = process.env.DATABASE_URL ?? 'postgres://klockr:klockr@localhost:54329/klockr_dev';
const handle = createDatabase(url);
const persistence = () => ({
  store: new PgShowStore(handle.db),
  idempotency: new PgIdempotencyStore(handle.db),
});

beforeAll(async () => {
  await runMigrations(handle);
});
afterAll(async () => {
  await handle.close();
});

describe('server + PostgreSQL (requires PostgreSQL)', () => {
  it('a Quick Timer survives a server restart; board token reads but cannot mutate', async () => {
    const first = await startTestServer({ persistence: persistence() });
    const created = await fetch(`${first.baseUrl}/api/v1/shows`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ durationMs: 120_000 }),
    });
    expect(created.status).toBe(201);
    const { showId, boardShareToken } = (await created.json()) as {
      showId: string;
      boardShareToken: string;
    };
    const cookie = cookieFrom(created.headers.getSetCookie());
    const state = (await (
      await fetch(`${first.baseUrl}/api/v1/shows/${showId}/state`, { headers: { cookie } })
    ).json()) as {
      queues: { items: { id: string }[] }[];
    };
    const itemId = state.queues[0]?.items[0]?.id ?? '';

    const start = await fetch(`${first.baseUrl}/api/v1/shows/${showId}/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        commandId: crypto.randomUUID(),
        type: 'timer.start',
        payload: { queueItemId: itemId },
      }),
    });
    expect(start.status).toBe(200);
    await first.close();

    // New process-equivalent: fresh app, fresh repositories, same database.
    const second = await startTestServer({ persistence: persistence() });
    try {
      const reloaded = await fetch(`${second.baseUrl}/api/v1/shows/${showId}/state`, {
        headers: { cookie },
      });
      expect(reloaded.status).toBe(200);
      expect(await reloaded.json()).toMatchObject({
        queues: [{ currentItemId: itemId, items: [{ timer: { status: 'running', revision: 1 } }] }],
      });

      const board = await fetch(`${second.baseUrl}/api/v1/board/state`, {
        headers: { authorization: `Bearer ${boardShareToken}` },
      });
      expect(board.status).toBe(200);
      expect(await board.json()).toMatchObject({
        queues: [{ timers: [{ status: 'running', revision: 1 }] }],
      });

      const socket = second.connect({ role: 'board', boardShareToken });
      expect((await nextEvent(socket, 'board.snapshot')).queues[0]?.timers[0]?.revision).toBe(1);

      const mutate = await fetch(`${second.baseUrl}/api/v1/shows/${showId}/commands`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${boardShareToken}` },
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          type: 'timer.stop',
          payload: { queueItemId: itemId },
        }),
      });
      expect(mutate.status).toBe(401);
      const after = await fetch(`${second.baseUrl}/api/v1/board/state`, {
        headers: { authorization: `Bearer ${boardShareToken}` },
      });
      expect(await after.json()).toMatchObject({ timer: { status: 'running' } });
    } finally {
      await second.close();
    }
  });
});
