import {
  authenticateToken,
  createQuickTimer,
  executeQueueCommand,
  getAuditTrail,
  GrantAuthorizer,
  runShowTimerCommand,
  type ShowServiceDeps,
} from '@klockr/application';
import { FakeTokenService, RecordingEventPublisher } from '@klockr/application/testing';
import {
  calculateSchedule,
  ManualClock,
  MINUTE_MS,
  setItemSchedule,
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

/** Fresh adapters per call = a server restart (nothing kept in memory). */
function services(clock: ManualClock): ShowServiceDeps {
  const store = new PgShowStore(handle.db);
  return {
    clock,
    shows: store,
    queues: store,
    timers: store,
    grants: store,
    audit: store,
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
const at = (h: number, m: number) => Date.UTC(2026, 10, 10, h, m);

async function setup() {
  const clock = new ManualClock(at(8, 55));
  const deps = services(clock);
  const created = await createQuickTimer(
    { durationMs: 10 * MINUTE_MS, timeZone: 'Europe/Amsterdam', scheduleDate: '2026-11-10' },
    deps,
  );
  if (!created.ok) throw new Error('create failed');
  const showId = ShowId(created.value.showId);
  const owner = await authenticateToken(created.value.ownerToken, 'owner', deps);
  const board = await authenticateToken(created.value.boardShareToken, 'board', deps);
  if (!owner || !board) throw new Error('auth failed');
  const run = async (body: Body, d: ShowServiceDeps = deps) => {
    const result = await executeQueueCommand(
      showId,
      { commandId: randomUUID(), ...body } as QueueCommandDto,
      { actor: owner.actor },
      d,
    );
    if (!result.ok) throw new Error(`${body.type}: ${result.error.message}`);
    return result.value;
  };
  const load = async (): Promise<QueueAggregate> => {
    const d = services(clock);
    const show = await d.shows.getShow(showId);
    const agg = show ? await d.queues.loadQueue(show.primaryQueueId) : null;
    if (!agg) throw new Error('queue missing');
    return agg;
  };
  const timer = (type: 'timer.start' | 'timer.adjust', queueItemId: string, extra: object = {}) =>
    runShowTimerCommand(
      showId,
      { commandId: randomUUID(), type, payload: { queueItemId, ...extra } } as never,
      { actor: owner.actor },
      deps,
    );
  return { clock, deps, showId, owner, board, run, load, timer };
}

/** Opening 09:00 10m, Speaker A 20m, Speaker B 20m, Lunch 09:50 FIXED. */
async function rundown(s: Awaited<ReturnType<typeof setup>>) {
  const opening = (await s.load()).items[0]?.id ?? '';
  await s.run({
    type: 'item.update',
    payload: { queueItemId: opening, patch: { title: 'Opening' } },
  });
  const a =
    (await s.run({ type: 'item.add', payload: { title: 'Speaker A', durationMs: 20 * MINUTE_MS } }))
      .createdId ?? '';
  const b =
    (await s.run({ type: 'item.add', payload: { title: 'Speaker B', durationMs: 20 * MINUTE_MS } }))
      .createdId ?? '';
  const lunch =
    (await s.run({ type: 'item.add', payload: { title: 'Lunch', durationMs: 45 * MINUTE_MS } }))
      .createdId ?? '';
  await s.run({
    type: 'item.setSchedule',
    payload: { queueItemId: opening, plannedStartAt: at(9, 0) },
  });
  await s.run({
    type: 'item.setSchedule',
    payload: { queueItemId: lunch, plannedStartAt: at(9, 50), fixedAnchor: true },
  });
  return { opening, a, b, lunch };
}

describe('PostgreSQL scheduling, locks and audit (requires PostgreSQL)', () => {
  it('planning, actuals, timing modes, locks and audit survive a restart; projection reconstructs', async () => {
    const s = await setup();
    const { opening, a, b, lunch } = await rundown(s);
    await s.run({ type: 'queue.setTimingMode', payload: { mode: 'sliding' } });
    s.clock.set(at(9, 0));
    await s.timer('timer.start', opening);
    s.clock.set(at(9, 14));
    await s.run({ type: 'item.end', payload: { queueItemId: opening, next: true } });
    await s.timer('timer.start', a);
    await s.run({ type: 'lock.set', payload: { target: { kind: 'item', id: b } } });
    await s.run({
      type: 'lock.requestUnlock',
      payload: { target: { kind: 'item', id: b }, reason: 'rename' },
    });

    const reloaded = await s.load();
    const byId = (id: string) => reloaded.items.find((i) => i.id === id);
    expect(byId(opening)).toMatchObject({
      plannedStartAt: at(9, 0),
      actualStartAt: at(9, 0),
      actualEndAt: at(9, 14),
    });
    expect(byId(a)?.actualStartAt).toBe(at(9, 14));
    expect(byId(lunch)).toMatchObject({ plannedStartAt: at(9, 50), fixedAnchor: true });
    expect(reloaded.queue.timingMode).toBe('sliding');
    expect(reloaded.showSchedule).toMatchObject({
      timeZone: 'Europe/Amsterdam',
      scheduleDate: '2026-11-10',
    });
    expect(reloaded.locks.map((l) => l.target)).toEqual([{ kind: 'item', id: b }]);
    expect(reloaded.unlockRequests.map((r) => r.reason)).toEqual(['rename']);

    // The projection is a pure function of the reloaded state: same result as before restart.
    const projection = calculateSchedule(reloaded, at(9, 15));
    expect(projection.showOffsetMs).toBe(4 * MINUTE_MS);
    expect(projection.items.find((i) => i.id === b)).toMatchObject({
      plannedStart: at(9, 30),
      projectedStart: at(9, 34),
    });
    expect(projection.nextAnchor).toMatchObject({
      itemId: lunch,
      recoveryMs: 4 * MINUTE_MS,
      status: 'risk',
    });

    // Strict after reload: Planned intact, same projection here (behind propagates in both modes).
    await s.run({ type: 'queue.setTimingMode', payload: { mode: 'strict' } }, services(s.clock));
    const strict = await s.load();
    expect(calculateSchedule(strict, at(9, 15)).items.find((i) => i.id === b)).toMatchObject({
      plannedStart: at(9, 30),
      projectedStart: at(9, 34),
    });

    const audit = await getAuditTrail(s.showId, { actor: s.owner.actor }, services(s.clock));
    if (!audit.ok) throw new Error('audit');
    expect(audit.value.map((e) => e.action)).toEqual([
      'timing_mode.update',
      'lock.request_unlock',
      'lock.set',
      'timing_mode.update',
      'anchor.update',
      'schedule.update',
      'schedule.update',
    ]);
  });

  it('Emergency Override is audited atomically with the change it performed', async () => {
    const s = await setup();
    const { b } = await rundown(s);
    await s.run({
      type: 'lock.set',
      payload: { target: { kind: 'queue', id: (await s.load()).queue.id } },
    });
    const blocked = await executeQueueCommand(
      s.showId,
      {
        commandId: randomUUID(),
        type: 'item.update',
        payload: { queueItemId: b, patch: { title: 'X' } },
      },
      { actor: s.owner.actor },
      s.deps,
    );
    expect(!blocked.ok && blocked.error.code).toBe('locked');
    await s.run({
      type: 'item.update',
      override: { reason: 'live fix' },
      payload: { queueItemId: b, patch: { title: 'Speaker B*' } },
    });
    const agg = await s.load();
    expect(agg.items.find((i) => i.id === b)?.title).toBe('Speaker B*');
    const audit = await services(s.clock).audit.listAudit(s.showId, 10);
    expect(audit[0]).toMatchObject({
      action: 'lock.override',
      resource: { kind: 'queue' },
      details: { reason: 'live fix', command: 'item.update' },
    });
  });

  it('atomic scheduling change: a stale save writes neither planning nor audit', async () => {
    const s = await setup();
    const prev = await s.load();
    const first = prev.items[0];
    if (!first) throw new Error('item');
    const planned = setItemSchedule(
      prev,
      { id: first.id, patch: { plannedStartAt: at(10, 0) } },
      { now: s.clock.now(), newId: randomUUID },
    );
    if (!planned.ok) throw new Error('plan');
    await s.run({
      type: 'item.update',
      payload: { queueItemId: first.id, patch: { title: 'concurrent' } },
    });
    const stale = await s.deps.queues.saveQueue(prev, planned.value, [
      {
        id: randomUUID(),
        showId: s.showId,
        at: s.clock.now(),
        actor: s.owner.actor,
        action: 'schedule.update',
        resource: { kind: 'item', id: first.id },
        details: {},
      },
    ]);
    expect(!stale.ok && stale.error.code).toBe('revision_conflict');
    expect((await s.load()).items[0]?.plannedStartAt).toBeNull();
    expect(await services(s.clock).audit.listAudit(s.showId, 10)).toHaveLength(0);
  });

  it('a board token cannot change planning or locks, nor read the audit trail', async () => {
    const s = await setup();
    const first = (await s.load()).items[0]?.id ?? '';
    for (const body of [
      { type: 'item.setSchedule', payload: { queueItemId: first, plannedStartAt: at(9, 0) } },
      { type: 'lock.set', payload: { target: { kind: 'item', id: first } } },
      { type: 'queue.setTimingMode', payload: { mode: 'sliding' } },
    ] as Body[]) {
      const result = await executeQueueCommand(
        s.showId,
        { commandId: randomUUID(), ...body } as QueueCommandDto,
        { actor: s.board.actor },
        s.deps,
      );
      expect(!result.ok && result.error.code).toBe('forbidden');
    }
    const audit = await getAuditTrail(s.showId, { actor: s.board.actor }, s.deps);
    expect(!audit.ok && audit.error.code).toBe('forbidden');
    expect((await s.load()).locks).toHaveLength(0);
  });
});
