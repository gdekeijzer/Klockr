import {
  authenticateToken,
  createQuickTimer,
  executeQueueCommand,
  GrantAuthorizer,
  getBoardState,
  runShowTimerCommand,
  type ShowServiceDeps,
} from '@klockr/application';
import { FakeTokenService, RecordingEventPublisher } from '@klockr/application/testing';
import {
  BoardId,
  endItem,
  ManualClock,
  MINUTE_MS,
  orderedItems,
  ShowId,
  type QueueAggregate,
} from '@klockr/domain';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from './client';
import { runMigrations } from './migrate';
import { PgIdempotencyStore, PgShowStore } from './repositories';

const url = process.env.DATABASE_URL ?? 'postgres://klockr:klockr@localhost:54329/klockr_dev';
const handle = createDatabase(url);
const tokens = new FakeTokenService(randomUUID().slice(0, 8));

beforeAll(async () => {
  await runMigrations(handle);
});
afterAll(async () => {
  await handle.close();
});

/** Fresh adapters per call: nothing survives in memory, as after a server restart. */
function services(clock: ManualClock): ShowServiceDeps & { store: PgShowStore } {
  const store = new PgShowStore(handle.db);
  return {
    store,
    clock,
    shows: store,
    queues: store,
    timers: store,
    grants: store,
    locator: store,
    tokens,
    ids: { uuid: () => randomUUID() },
    idempotency: new PgIdempotencyStore(handle.db),
    events: new RecordingEventPublisher(),
    authorizer: new GrantAuthorizer({ grants: store, locator: store, clock }),
  };
}

type QueueCommandDto = Parameters<typeof executeQueueCommand>[1];
type Body = Omit<QueueCommandDto, 'commandId'>;

async function setup() {
  const clock = new ManualClock(Date.UTC(2026, 10, 9, 12, 0, 0));
  const deps = services(clock);
  const created = await createQuickTimer({ durationMs: 5 * MINUTE_MS }, deps);
  if (!created.ok) throw new Error('create failed');
  const showId = ShowId(created.value.showId);
  const owner = await authenticateToken(created.value.ownerToken, 'owner', deps);
  const board = await authenticateToken(created.value.boardShareToken, 'board', deps);
  if (!owner || !board) throw new Error('auth failed');
  const run = async (body: Body, d: ShowServiceDeps = deps, actor = owner.actor) => {
    const result = await executeQueueCommand(
      showId,
      { commandId: randomUUID(), ...body } as QueueCommandDto,
      { actor },
      d,
    );
    if (!result.ok) throw new Error(`${body.type}: ${result.error.message}`);
    return result.value;
  };
  const load = async (d: ShowServiceDeps = services(clock)): Promise<QueueAggregate> => {
    const show = await d.shows.getShow(showId);
    const agg = show ? await d.queues.loadQueue(show.primaryQueueId) : null;
    if (!agg) throw new Error('queue missing');
    return agg;
  };
  return { clock, deps, showId, owner, board, run, load, created: created.value };
}

describe('PostgreSQL Queue persistence (requires PostgreSQL)', () => {
  it('reloads the whole Queue after a restart: order, groups, current, completed, active, timers, overrides', async () => {
    const { clock, run, load } = await setup();
    const a =
      (
        await run({
          type: 'item.add',
          payload: {
            title: 'Speaker A',
            durationMs: 10 * MINUTE_MS,
            subtitle: 'CEO',
            notes: 'Headset 3',
            tags: ['vip'],
          },
        })
      ).createdId ?? '';
    const note =
      (await run({ type: 'item.add', payload: { title: 'Note', durationMs: null } })).createdId ??
      '';
    const b =
      (
        await run({
          type: 'item.add',
          payload: { title: 'Speaker B', durationMs: 15 * MINUTE_MS, startMode: 'on_previous_end' },
        })
      ).createdId ?? '';
    const group = (await run({ type: 'group.add', payload: { title: 'Morning' } })).createdId ?? '';
    await run({ type: 'item.move', payload: { queueItemId: b, groupId: group, index: 0 } });
    await run({ type: 'item.move', payload: { queueItemId: note, groupId: null, index: 0 } });
    await run({ type: 'item.setActive', payload: { queueItemId: note, active: false } });
    await run({
      type: 'item.setWarning',
      payload: {
        queueItemId: a,
        warning: { kind: 'absolute', warningMs: 120_000, criticalMs: 30_000 },
      },
    });
    await run({
      type: 'queue.setWarning',
      payload: { warning: { kind: 'percent', warningPercent: 30, criticalPercent: 10 } },
    });
    await run({ type: 'queue.setCurrent', payload: { queueItemId: a } });
    clock.advance(1_000);
    await run({ type: 'item.end', payload: { queueItemId: a, next: true } });

    const agg = await load();
    expect(orderedItems(agg).map((i) => i.title)).toEqual([
      'Note',
      'Timer',
      'Speaker A',
      'Speaker B',
    ]);
    expect(agg.groups.map((g) => g.title)).toEqual(['Morning']);
    expect(agg.items.find((i) => i.id === b)?.groupId).toBe(group);
    expect(agg.queue.currentItemId).toBe(b);
    const itemA = agg.items.find((i) => i.id === a);
    expect(itemA).toMatchObject({
      subtitle: 'CEO',
      notes: 'Headset 3',
      tags: ['vip'],
      completedAt: clock.now(),
    });
    expect(itemA?.warning).toEqual({ kind: 'absolute', warningMs: 120_000, criticalMs: 30_000 });
    expect(agg.queue.warning).toEqual({ kind: 'percent', warningPercent: 30, criticalPercent: 10 });
    expect(agg.items.find((i) => i.id === note)).toMatchObject({ active: false, timer: null });
    // Auto-start from the start mode survived as a running timer.
    expect(agg.items.find((i) => i.id === b)?.timer).toMatchObject({
      status: 'running',
      startedAt: clock.now(),
    });
  });

  it('reorder persists and positions stay dense', async () => {
    const { run, load } = await setup();
    const a = (await run({ type: 'item.add', payload: { title: 'A' } })).createdId ?? '';
    await run({ type: 'item.add', payload: { title: 'B' } });
    await run({ type: 'item.move', payload: { queueItemId: a, groupId: null, index: 99 } });
    const agg = await load();
    expect(orderedItems(agg).map((i) => `${i.title}@${String(i.position)}`)).toEqual([
      'Timer@0',
      'B@1',
      'A@2',
    ]);
  });

  it('a board token cannot mutate the Queue, but follows the current item', async () => {
    const { deps, showId, board, run, created, load } = await setup();
    const a =
      (await run({ type: 'item.add', payload: { title: 'Speaker A', durationMs: MINUTE_MS } }))
        .createdId ?? '';
    const before = (await load()).queue.revision;
    const attempt = await executeQueueCommand(
      showId,
      { commandId: randomUUID(), type: 'queue.setCurrent', payload: { queueItemId: a } },
      { actor: board.actor },
      deps,
    );
    expect(!attempt.ok && attempt.error.code).toBe('forbidden');
    expect((await load()).queue.revision).toBe(before);

    await run({ type: 'queue.setCurrent', payload: { queueItemId: a } });
    const grant = await deps.grants.findByTokenHash(tokens.hash(created.boardShareToken));
    const state = await getBoardState(
      BoardId(grant?.boardId ?? ''),
      { actor: board.actor },
      services(deps.clock as ManualClock),
    );
    expect(state.ok && state.value.current?.title).toBe('Speaker A');
    expect(state.ok && 'notes' in (state.value.current ?? {})).toBe(false);
  });

  it('END + NEXT is atomic: a lost timer race rolls back the whole transition', async () => {
    const { clock, deps, run, load, showId, owner } = await setup();
    const a =
      (await run({ type: 'item.add', payload: { title: 'A', durationMs: MINUTE_MS } })).createdId ??
      '';
    const b =
      (
        await run({
          type: 'item.add',
          payload: { title: 'B', durationMs: MINUTE_MS, startMode: 'on_previous_end' },
        })
      ).createdId ?? '';
    await run({ type: 'queue.setCurrent', payload: { queueItemId: a } });
    await runShowTimerCommand(
      showId,
      { commandId: randomUUID(), type: 'timer.start', payload: { queueItemId: a } },
      { actor: owner.actor },
      deps,
    );

    // Read, then let a concurrent timer command change A's timer before the save.
    const prev = await load();
    const itemA = prev.items.find((i) => i.id === a);
    if (!itemA) throw new Error('missing A');
    const ended = endItem(
      prev,
      { id: itemA.id, advance: true },
      { now: clock.now(), newId: () => randomUUID() },
    );
    if (!ended.ok) throw new Error('end failed');
    await runShowTimerCommand(
      showId,
      { commandId: randomUUID(), type: 'timer.pause', payload: { queueItemId: a } },
      { actor: owner.actor },
      deps,
    );

    const saved = await deps.queues.saveQueue(prev, ended.value.aggregate);
    expect(!saved.ok && saved.error.code).toBe('revision_conflict');

    // Nothing of the END + NEXT was written.
    const after = await load();
    expect(after.queue.revision).toBe(prev.queue.revision);
    expect(after.queue.currentItemId).toBe(a);
    expect(after.items.find((i) => i.id === a)?.completedAt).toBeNull();
    expect(after.items.find((i) => i.id === a)?.timer?.status).toBe('paused');
    expect(after.items.find((i) => i.id === b)?.timer?.status).toBe('idle');

    // The same command through the application layer re-evaluates and succeeds atomically.
    await run({ type: 'item.end', payload: { queueItemId: a, next: true } });
    const done = await load();
    expect(done.queue.currentItemId).toBe(b);
    expect(done.items.find((i) => i.id === a)?.timer?.status).toBe('stopped');
    expect(done.items.find((i) => i.id === b)?.timer?.status).toBe('running');
  });

  it('a concurrent structural writer with a stale Queue revision is rejected', async () => {
    const { run, load, deps } = await setup();
    const prev = await load();
    await run({ type: 'item.add', payload: { title: 'Winner' } });
    const stale = await deps.queues.saveQueue(prev, {
      ...prev,
      queue: { ...prev.queue, revision: prev.queue.revision + 1 },
    });
    expect(!stale.ok && stale.error.code).toBe('revision_conflict');
  });

  it('deleting items and groups removes them durably', async () => {
    const { run, load } = await setup();
    const group = (await run({ type: 'group.add', payload: { title: 'G' } })).createdId ?? '';
    await run({
      type: 'item.add',
      payload: { title: 'In group', durationMs: MINUTE_MS, groupId: group },
    });
    await run({ type: 'group.duplicate', payload: { groupId: group } });
    expect((await load()).items).toHaveLength(3);
    await run({ type: 'group.delete', payload: { groupId: group } });
    const agg = await load();
    expect(agg.groups).toHaveLength(1);
    expect(orderedItems(agg).map((i) => i.title)).toEqual(['Timer', 'In group']);
  });
});
