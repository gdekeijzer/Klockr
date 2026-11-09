import type { QueueCommandDto } from '@klockr/contracts';
import {
  ManualClock,
  MINUTE_MS,
  type Permission,
  type QueueAggregate,
  type ShowId,
} from '@klockr/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { authenticateToken } from '../auth';
import { GrantAuthorizer } from '../auth/grant-authorizer';
import type { CommandContext } from '../command';
import type { Authorizer } from '../ports';
import {
  createQuickTimer,
  getAuditTrail,
  runShowTimerCommand,
  type ShowServiceDeps,
} from '../show';
import {
  FakeTokenService,
  InMemoryIdempotencyStore,
  InMemoryStore,
  RecordingEventPublisher,
  SequentialIds,
} from '../testing';
import type { TimerCommand } from '../timer';
import { executeQueueCommand } from './queue-commands';

type Body = Omit<QueueCommandDto, 'commandId'>;
let seq = 0;
const cid = () => `00000000-0000-4000-9000-${String(++seq).padStart(12, '0')}`;

describe('M3 scheduling, locks and audit (application layer)', () => {
  let clock: ManualClock;
  let store: InMemoryStore;
  let deps: ShowServiceDeps;
  let showId: ShowId;
  let owner: CommandContext;
  let board: CommandContext;
  let first: string;

  beforeEach(async () => {
    clock = new ManualClock(Date.UTC(2026, 10, 10, 9, 0));
    store = new InMemoryStore();
    deps = {
      clock,
      shows: store,
      state: store,
      timers: store,
      grants: store,
      audit: store,
      locator: store,
      tokens: new FakeTokenService(),
      ids: new SequentialIds(),
      idempotency: new InMemoryIdempotencyStore(),
      events: new RecordingEventPublisher(),
      authorizer: new GrantAuthorizer({ grants: store, locator: store, clock }),
    };
    const created = await createQuickTimer(
      { durationMs: 10 * MINUTE_MS, timeZone: 'Europe/Amsterdam', scheduleDate: '2026-11-10' },
      deps,
    );
    if (!created.ok) throw new Error('setup');
    showId = created.value.showId;
    const o = await authenticateToken(created.value.ownerToken, 'owner', deps);
    const b = await authenticateToken(created.value.boardShareToken, 'board', deps);
    if (!o || !b) throw new Error('setup');
    owner = { actor: o.actor };
    board = { actor: b.actor };
    first = (await aggregate()).items[0]?.id ?? '';
  });

  async function aggregate(): Promise<QueueAggregate> {
    const show = store.shows.get(showId);
    const agg = show ? await store.loadQueue(show.primaryQueueId) : null;
    if (!agg) throw new Error('no queue');
    return agg;
  }
  const run = (body: Body, context: CommandContext = owner, d: ShowServiceDeps = deps) =>
    executeQueueCommand(showId, { commandId: cid(), ...body } as QueueCommandDto, context, d);
  async function ok(body: Body, context: CommandContext = owner) {
    const result = await run(body, context);
    if (!result.ok) throw new Error(`${body.type}: ${result.error.code} ${result.error.message}`);
    return result.value;
  }
  const timer = (type: TimerCommand['type'], queueItemId: string, extra: object = {}) =>
    runShowTimerCommand(
      showId,
      { commandId: cid(), type, payload: { queueItemId, ...extra } } as TimerCommand,
      owner,
      deps,
    );
  const itemOf = async (id: string) => (await aggregate()).items.find((i) => i.id === id);
  const actions = () => store.audit.map((a) => a.action);

  it('show timezone/date come from creation', async () => {
    expect((await aggregate()).showSchedule).toMatchObject({
      timeZone: 'Europe/Amsterdam',
      scheduleDate: '2026-11-10',
      timingMode: 'strict',
      toleranceMs: 30_000,
    });
  });

  it('planned schedule edit and fixed anchor set/unset are persisted and audited', async () => {
    const lunch =
      (await ok({ type: 'item.add', payload: { title: 'Lunch', durationMs: 45 * MINUTE_MS } }))
        .createdId ?? '';
    const t = Date.UTC(2026, 10, 10, 12, 0);
    await ok({
      type: 'item.setSchedule',
      payload: { queueItemId: lunch, plannedStartAt: t, fixedAnchor: true },
    });
    expect(await itemOf(lunch)).toMatchObject({ plannedStartAt: t, fixedAnchor: true });
    await ok({ type: 'item.setSchedule', payload: { queueItemId: lunch, fixedAnchor: false } });
    expect((await itemOf(lunch))?.fixedAnchor).toBe(false);
    expect(actions()).toEqual([
      'schedule.update',
      'anchor.update',
      'schedule.update',
      'anchor.update',
    ]);
    expect(store.audit[0]).toMatchObject({
      actor: owner.actor,
      resource: { kind: 'item', id: lunch },
      details: { after: { plannedStartAt: t, fixedAnchor: true } },
    });
    const invalid = await run({
      type: 'item.setSchedule',
      payload: { queueItemId: lunch, plannedStartAt: null, fixedAnchor: true },
    });
    expect(!invalid.ok && invalid.error.code).toBe('validation_failed');
  });

  it('timing mode: Show default and Queue override, both audited', async () => {
    await ok({ type: 'show.setSchedule', payload: { timingMode: 'sliding' } });
    await ok({ type: 'queue.setTimingMode', payload: { mode: 'strict' } });
    const agg = await aggregate();
    expect(agg.showSchedule.timingMode).toBe('sliding');
    expect(agg.queue.timingMode).toBe('strict');
    expect(actions()).toEqual(['timing_mode.update', 'timing_mode.update']);
    await ok({ type: 'queue.setTimingMode', payload: { mode: null } });
    expect((await aggregate()).queue.timingMode).toBeNull();
  });

  it('START sets actualStart once; END sets actualEnd; Planned untouched', async () => {
    const before = await itemOf(first);
    clock.advance(4 * MINUTE_MS);
    await timer('timer.start', first);
    expect((await itemOf(first))?.actualStartAt).toBe(clock.now());
    const started = clock.now();
    await timer('timer.stop', first);
    clock.advance(MINUTE_MS);
    await timer('timer.start', first);
    expect((await itemOf(first))?.actualStartAt).toBe(started);
    clock.advance(MINUTE_MS);
    await ok({ type: 'item.end', payload: { queueItemId: first, next: false } });
    const after = await itemOf(first);
    expect(after?.actualEndAt).toBe(clock.now());
    expect(after?.plannedStartAt).toBe(before?.plannedStartAt);
  });

  it('timer adjustments bump the Queue revision so every client recalculates the projection', async () => {
    await timer('timer.start', first);
    const revision = (await aggregate()).queue.revision;
    await timer('timer.adjust', first, { deltaMs: 5 * MINUTE_MS });
    expect((await aggregate()).queue.revision).toBe(revision + 1);
  });

  describe('locks', () => {
    let speakerB: string;
    beforeEach(async () => {
      speakerB =
        (
          await ok({
            type: 'item.add',
            payload: { title: 'Speaker B', durationMs: 20 * MINUTE_MS },
          })
        ).createdId ?? '';
      await ok({ type: 'lock.set', payload: { target: { kind: 'item', id: speakerB } } });
    });

    it('blocks structure/planning/timing edits of the locked item with `locked`', async () => {
      for (const body of [
        { type: 'item.update', payload: { queueItemId: speakerB, patch: { title: 'X' } } },
        { type: 'item.delete', payload: { queueItemId: speakerB } },
        { type: 'item.move', payload: { queueItemId: speakerB, groupId: null, index: 0 } },
        { type: 'item.setSchedule', payload: { queueItemId: speakerB, plannedStartAt: 0 } },
      ] as Body[]) {
        const result = await run(body);
        expect(!result.ok && result.error.code).toBe('locked');
      }
      const configure = await timer('timer.configure', speakerB, {
        mode: 'countdown',
        durationMs: MINUTE_MS,
      });
      expect(!configure.ok && configure.error.code).toBe('locked');
    });

    it('never blocks live operation: set current, START, END / NEXT', async () => {
      await ok({ type: 'queue.setCurrent', payload: { queueItemId: speakerB } });
      expect((await timer('timer.start', speakerB)).ok).toBe(true);
      await ok({ type: 'item.end', payload: { queueItemId: speakerB, next: true } });
    });

    it('a Queue lock is inherited by every item', async () => {
      await ok({ type: 'lock.release', payload: { target: { kind: 'item', id: speakerB } } });
      await ok({
        type: 'lock.set',
        payload: { target: { kind: 'queue', id: (await aggregate()).queue.id } },
      });
      const result = await run({ type: 'item.add', payload: { title: 'new' } });
      expect(!result.ok && result.error).toMatchObject({
        code: 'locked',
        details: { lock: { target: { kind: 'queue' } } },
      });
      const edit = await run({
        type: 'item.update',
        payload: { queueItemId: first, patch: { title: 'X' } },
      });
      expect(!edit.ok && edit.error.details).toMatchObject({ inheritedFrom: { kind: 'queue' } });
    });

    it('request unlock, unlock — all audited', async () => {
      await ok({
        type: 'lock.requestUnlock',
        payload: { target: { kind: 'item', id: speakerB }, reason: 'fix typo' },
      });
      expect((await aggregate()).unlockRequests).toHaveLength(1);
      await ok({ type: 'lock.release', payload: { target: { kind: 'item', id: speakerB } } });
      expect((await aggregate()).unlockRequests).toHaveLength(0);
      expect(actions()).toEqual(['lock.set', 'lock.request_unlock', 'lock.release']);
      expect(store.audit[1]?.details).toMatchObject({ reason: 'fix typo' });
      expect(
        (
          await run({
            type: 'item.update',
            payload: { queueItemId: speakerB, patch: { title: 'B2' } },
          })
        ).ok,
      ).toBe(true);
    });

    it('Emergency Override: explicit, permission-gated, audited with actor, reason and command', async () => {
      const result = await run({
        type: 'item.update',
        override: { reason: 'Speaker renamed on stage' },
        payload: { queueItemId: speakerB, patch: { title: 'Speaker B (new)' } },
      });
      expect(result.ok).toBe(true);
      expect((await itemOf(speakerB))?.title).toBe('Speaker B (new)');
      // The lock stays: the override is per action, not an unlock.
      expect((await aggregate()).locks).toHaveLength(1);
      const record = store.audit.find((a) => a.action === 'lock.override');
      expect(record).toMatchObject({
        actor: owner.actor,
        at: clock.now(),
        resource: { kind: 'item', id: speakerB },
        details: { reason: 'Speaker renamed on stage', command: 'item.update' },
      });
    });

    it('Emergency Override without the lock.override capability is forbidden', async () => {
      const restricted: Authorizer = {
        can: (actor, permission: Permission, resource) =>
          permission === 'lock.override'
            ? Promise.resolve(false)
            : deps.authorizer.can(actor, permission, resource),
      };
      const result = await run(
        {
          type: 'item.update',
          override: { reason: 'try' },
          payload: { queueItemId: speakerB, patch: { title: 'nope' } },
        },
        owner,
        { ...deps, authorizer: restricted },
      );
      expect(!result.ok && result.error.code).toBe('forbidden');
      expect(store.audit.some((a) => a.action === 'lock.override')).toBe(false);
    });

    it('a board share can never lock, request, override, plan or read the audit trail', async () => {
      for (const body of [
        { type: 'lock.release', payload: { target: { kind: 'item', id: speakerB } } },
        { type: 'lock.requestUnlock', payload: { target: { kind: 'item', id: speakerB } } },
        { type: 'item.setSchedule', payload: { queueItemId: first, plannedStartAt: 0 } },
        { type: 'show.setSchedule', payload: { timingMode: 'sliding' } },
      ] as Body[]) {
        const result = await run(body, board);
        expect(!result.ok && result.error.code).toBe('forbidden');
      }
      const audit = await getAuditTrail(showId, board, deps);
      expect(!audit.ok && audit.error.code).toBe('forbidden');
      expect((await getAuditTrail(showId, owner, deps)).ok).toBe(true);
    });
  });

  it('revision conflict and idempotent replay for planning commands', async () => {
    const revision = (await aggregate()).queue.revision;
    await ok({
      type: 'item.setSchedule',
      payload: { queueItemId: first, plannedStartAt: clock.now() },
    });
    const stale = await run({
      type: 'item.setSchedule',
      expectedRevision: revision,
      payload: { queueItemId: first, plannedStartAt: 0 },
    });
    expect(!stale.ok && stale.error.code).toBe('revision_conflict');

    const body = {
      commandId: cid(),
      type: 'lock.set',
      idempotencyKey: 'lock-key-1',
      payload: { target: { kind: 'item', id: first } },
    } as QueueCommandDto;
    const a = await executeQueueCommand(showId, body, owner, deps);
    const b = await executeQueueCommand(showId, body, owner, deps);
    expect(b).toEqual(a);
    expect((await aggregate()).locks).toHaveLength(1);
    expect(actions().filter((x) => x === 'lock.set')).toHaveLength(1);
  });
});
