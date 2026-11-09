import {
  authenticateToken,
  createQuickTimer,
  GrantAuthorizer,
  getBoardState,
  getShowState,
  runShowTimerCommand,
  type ShowServiceDeps,
} from '@klockr/application';
import { FakeTokenService, RecordingEventPublisher } from '@klockr/application/testing';
import {
  BoardId,
  deriveTimer,
  ManualClock,
  MINUTE_MS,
  QueueItemId,
  SECOND_MS,
  ShowId,
} from '@klockr/domain';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from './client';
import { runMigrations } from './migrate';
import { PgIdempotencyStore, PgShowStore } from './repositories';

const url = process.env.DATABASE_URL ?? 'postgres://klockr:klockr@localhost:54329/klockr_dev';
const handle = createDatabase(url);

beforeAll(async () => {
  await runMigrations(handle);
});
afterAll(async () => {
  await handle.close();
});

function services(clock: ManualClock): ShowServiceDeps {
  const store = new PgShowStore(handle.db);
  return {
    clock,
    shows: store,
    timers: store,
    state: store,
    grants: store,
    audit: store,
    locator: store,
    tokens: new FakeTokenService(randomUUID().slice(0, 8)),
    ids: { uuid: () => randomUUID() },
    idempotency: new PgIdempotencyStore(handle.db),
    events: new RecordingEventPublisher(),
    authorizer: new GrantAuthorizer({ grants: store, locator: store, clock }),
  };
}

describe('PostgreSQL Show persistence (requires PostgreSQL)', () => {
  it('creates a Show, starts the timer and reloads the state from the database', async () => {
    const clock = new ManualClock(Date.UTC(2026, 10, 9, 10, 0, 0, 123));
    const deps = services(clock);
    const uniqueTokens = new FakeTokenService(randomUUID().slice(0, 8));
    const created = await createQuickTimer(
      { durationMs: 5 * MINUTE_MS },
      { ...deps, tokens: uniqueTokens },
    );
    if (!created.ok) throw new Error('create failed');
    const owner = await authenticateToken(created.value.ownerToken, 'owner', {
      ...deps,
      tokens: uniqueTokens,
    });
    if (!owner) throw new Error('owner auth failed');
    const ctx = { actor: owner.actor };

    const state = await getShowState(ShowId(created.value.showId), ctx, deps);
    if (!state.ok) throw new Error('state failed');
    const itemId = state.value.queues[0]?.items[0]?.id ?? '';

    const started = await runShowTimerCommand(
      ShowId(created.value.showId),
      { commandId: randomUUID(), type: 'timer.start', payload: { queueItemId: itemId } },
      ctx,
      deps,
    );
    expect(started.ok).toBe(true);

    // A fresh store instance simulates a server restart: nothing is held in memory.
    clock.advance(90 * SECOND_MS);
    const reloaded = services(clock);
    const timer = await reloaded.timers.get(QueueItemId(itemId));
    expect(timer).toMatchObject({
      status: 'running',
      revision: 1,
      startedAt: Date.UTC(2026, 10, 9, 10, 0, 0, 123),
    });
    if (!timer) throw new Error('missing');
    expect(deriveTimer(timer, clock.now()).remainingMs).toBe(3 * MINUTE_MS + 30 * SECOND_MS);
    const show = await reloaded.shows.getShow(ShowId(created.value.showId));
    expect(show?.expiresAt).toBe(Date.UTC(2026, 10, 16, 10, 0, 0, 123));

    // Board token reads its Board, but cannot mutate.
    const board = await authenticateToken(created.value.boardShareToken, 'board', {
      ...reloaded,
      tokens: uniqueTokens,
    });
    if (!board) throw new Error('board auth failed');
    const boardState = await getBoardState(
      BoardId(state.value.boards[0]?.id ?? ''),
      { actor: board.actor },
      reloaded,
    );
    expect(boardState.ok && boardState.value.queues[0]?.timers[0]?.status).toBe('running');
    const attempt = await runShowTimerCommand(
      ShowId(created.value.showId),
      { commandId: randomUUID(), type: 'timer.stop', payload: { queueItemId: itemId } },
      { actor: board.actor },
      reloaded,
    );
    expect(!attempt.ok && attempt.error.code).toBe('forbidden');
    expect((await reloaded.timers.get(QueueItemId(itemId)))?.status).toBe('running');
  });

  it('rejects a compare-and-set write with a stale revision', async () => {
    const clock = new ManualClock();
    const deps = services(clock);
    const created = await createQuickTimer({ durationMs: MINUTE_MS }, deps);
    if (!created.ok) throw new Error('create failed');
    const show = await deps.shows.getShow(ShowId(created.value.showId));
    const queue = show ? await new PgShowStore(handle.db).loadQueue(show.primaryQueueId) : null;
    const item = queue?.items[0];
    if (!item?.timer) throw new Error('missing');
    const next = { ...item.timer, status: 'running' as const, startedAt: clock.now(), revision: 1 };
    expect((await deps.timers.save(item.id, next, 0)).ok).toBe(true);
    const stale = await deps.timers.save(item.id, { ...next, revision: 2 }, 0);
    expect(!stale.ok && stale.error.code).toBe('revision_conflict');
  });

  it('persists idempotency records', async () => {
    const store = new PgIdempotencyStore(handle.db);
    const key = `key-${randomUUID()}`;
    await store.remember('scope', key, {
      fingerprint: 'fp',
      result: { ok: true, value: { x: 1 } },
    });
    await store.remember('scope', key, { fingerprint: 'other', result: { ok: true, value: 2 } });
    expect(await store.find('scope', key)).toEqual({
      fingerprint: 'fp',
      result: { ok: true, value: { x: 1 } },
    });
  });
});
