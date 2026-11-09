import type { QueueCommandDto } from '@klockr/contracts';
import {
  ManualClock,
  MINUTE_MS,
  orderedItems,
  SECOND_MS,
  type QueueAggregate,
  type ShowId,
} from '@klockr/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { authenticateToken } from '../auth';
import { GrantAuthorizer } from '../auth/grant-authorizer';
import type { CommandContext } from '../command';
import { createQuickTimer, runShowTimerCommand, type ShowServiceDeps } from '../show';
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
const cmd = (body: Body): QueueCommandDto =>
  ({
    commandId: `00000000-0000-4000-9000-${String(++seq).padStart(12, '0')}`,
    ...body,
  }) as QueueCommandDto;

describe('Queue commands (application layer)', () => {
  let clock: ManualClock;
  let store: InMemoryStore;
  let events: RecordingEventPublisher;
  let deps: ShowServiceDeps;
  let showId: ShowId;
  let owner: CommandContext;
  let board: CommandContext;
  let timerItem: string;

  beforeEach(async () => {
    clock = new ManualClock(1_000_000);
    store = new InMemoryStore();
    events = new RecordingEventPublisher();
    deps = {
      clock,
      shows: store,
      queues: store,
      timers: store,
      grants: store,
      audit: store,
      locator: store,
      tokens: new FakeTokenService(),
      ids: new SequentialIds(),
      idempotency: new InMemoryIdempotencyStore(),
      events,
      authorizer: new GrantAuthorizer({ grants: store, locator: store, clock }),
    };
    const created = await createQuickTimer({ durationMs: 10 * MINUTE_MS }, deps);
    if (!created.ok) throw new Error('setup');
    showId = created.value.showId;
    const o = await authenticateToken(created.value.ownerToken, 'owner', deps);
    const b = await authenticateToken(created.value.boardShareToken, 'board', deps);
    if (!o || !b) throw new Error('setup');
    owner = { actor: o.actor };
    board = { actor: b.actor };
    timerItem = (await aggregate()).items[0]?.id ?? '';
  });

  async function aggregate(): Promise<QueueAggregate> {
    const show = store.shows.get(showId);
    const agg = show ? await store.loadQueue(show.primaryQueueId) : null;
    if (!agg) throw new Error('no queue');
    return agg;
  }

  async function run(body: Body, context: CommandContext = owner) {
    return executeQueueCommand(showId, cmd(body), context, deps);
  }

  async function ok(body: Body) {
    const result = await run(body);
    if (!result.ok) throw new Error(`${body.type}: ${result.error.code} ${result.error.message}`);
    return result.value;
  }

  async function add(title: string, durationMs: number | null, extra: object = {}) {
    const out = await ok({ type: 'item.add', payload: { title, durationMs, ...extra } });
    return out.createdId ?? '';
  }

  const timer = (type: TimerCommand['type'], queueItemId: string) =>
    runShowTimerCommand(
      showId,
      { commandId: `t-${String(++seq)}`, type, payload: { queueItemId } } as TimerCommand,
      owner,
      deps,
    );

  const titles = async () => orderedItems(await aggregate()).map((i) => i.title);
  const current = async () => (await aggregate()).queue.currentItemId;
  const itemOf = async (id: string) => (await aggregate()).items.find((i) => i.id === id);

  describe('editing', () => {
    it('adds presets as plain Queue Items (timer, note without timer)', async () => {
      const speaker = await add('Speaker A', 10 * MINUTE_MS, { subtitle: 'CEO' });
      const note = await add('CEO arrives stage left', null);
      expect((await itemOf(speaker))?.timer?.durationMs).toBe(10 * MINUTE_MS);
      expect((await itemOf(note))?.timer).toBeNull();
      expect(await titles()).toEqual(['Timer', 'Speaker A', 'CEO arrives stage left']);
    });

    it('edits, duplicates, reorders and deletes', async () => {
      const a = await add('Speaker A', 10 * MINUTE_MS);
      const b = await add('Speaker B', 15 * MINUTE_MS);
      await ok({
        type: 'item.update',
        payload: { queueItemId: a, patch: { title: 'Jan', notes: 'Headset 3' } },
      });
      expect((await itemOf(a))?.notes).toBe('Headset 3');
      await ok({ type: 'item.duplicate', payload: { queueItemId: a } });
      expect(await titles()).toEqual(['Timer', 'Jan', 'Jan', 'Speaker B']);
      await ok({ type: 'item.move', payload: { queueItemId: b, groupId: null, index: 0 } });
      expect(await titles()).toEqual(['Speaker B', 'Timer', 'Jan', 'Jan']);
      await ok({ type: 'item.delete', payload: { queueItemId: b } });
      expect(await titles()).toEqual(['Timer', 'Jan', 'Jan']);
    });

    it('groups: add, move items in, duplicate and move as a whole', async () => {
      const a = await add('Speaker A', 10 * MINUTE_MS);
      const group =
        (await ok({ type: 'group.add', payload: { title: 'Morning' } })).createdId ?? '';
      await ok({ type: 'item.move', payload: { queueItemId: a, groupId: group, index: 0 } });
      await ok({ type: 'group.duplicate', payload: { groupId: group } });
      await ok({ type: 'group.move', payload: { groupId: group, index: 0 } });
      const agg = await aggregate();
      expect(agg.groups).toHaveLength(2);
      expect(await titles()).toEqual(['Speaker A', 'Timer', 'Speaker A']);
    });

    it('rejects invalid edits with typed errors', async () => {
      const missing = await run({
        type: 'item.delete',
        payload: { queueItemId: '00000000-0000-4000-8000-0000000000ff' },
      });
      expect(!missing.ok && missing.error.code).toBe('not_found');
      const deleteCurrent = await run({ type: 'item.delete', payload: { queueItemId: timerItem } });
      expect(!deleteCurrent.ok && deleteCurrent.error.code).toBe('invalid_transition');
    });

    it('publishes one queue.changed event per accepted change and records activity', async () => {
      clock.advance(5 * SECOND_MS);
      await add('Speaker A', MINUTE_MS);
      const last = events.events.at(-1);
      expect(last?.type).toBe('queue.changed');
      expect(last?.showId).toBe(showId);
      expect(store.shows.get(showId)?.lastActiveAt).toBe(clock.now());
    });
  });

  describe('current / END / NEXT', () => {
    let a: string;
    let note: string;
    let skipped: string;
    let b: string;

    beforeEach(async () => {
      a = await add('Speaker A', 10 * MINUTE_MS);
      note = await add('Note', null);
      skipped = await add('Technical note', null, { active: false });
      b = await add('Speaker B', 15 * MINUTE_MS);
      await ok({ type: 'queue.setCurrent', payload: { queueItemId: a } });
    });

    it('set current selects an item without starting or stopping any timer', async () => {
      await timer('timer.start', a);
      await ok({ type: 'queue.setCurrent', payload: { queueItemId: b } });
      expect(await current()).toBe(b);
      expect((await itemOf(a))?.timer?.status).toBe('running');
      expect((await itemOf(b))?.timer?.status).toBe('idle');
    });

    it('END on a running item stops its timer and completes it; it stays current', async () => {
      await timer('timer.start', a);
      clock.advance(MINUTE_MS);
      await ok({ type: 'item.end', payload: { queueItemId: a, next: false } });
      const item = await itemOf(a);
      expect(item?.completedAt).toBe(clock.now());
      expect(item?.timer?.status).toBe('stopped');
      expect(await current()).toBe(a);
    });

    it('END on an item with a stopped timer', async () => {
      await timer('timer.start', a);
      await timer('timer.stop', a);
      const before = (await itemOf(a))?.timer;
      await ok({ type: 'item.end', payload: { queueItemId: a, next: false } });
      expect((await itemOf(a))?.timer).toEqual(before);
      expect((await itemOf(a))?.completedAt).not.toBeNull();
    });

    it('END + NEXT walks the rundown: note without timer, inactive skipped, nothing auto-starts', async () => {
      await timer('timer.start', a);
      await ok({ type: 'item.end', payload: { queueItemId: a, next: true } });
      expect(await current()).toBe(note);
      // END on an item without timer.
      await ok({ type: 'item.end', payload: { queueItemId: note, next: true } });
      expect(await current()).toBe(b); // the inactive item was skipped
      expect((await itemOf(skipped))?.completedAt).toBeNull();
      expect((await itemOf(b))?.timer?.status).toBe('idle');
    });

    it('END + NEXT starts the next timer only with start mode on_previous_end, atomically', async () => {
      await ok({ type: 'item.setActive', payload: { queueItemId: note, active: false } });
      await ok({
        type: 'item.update',
        payload: { queueItemId: b, patch: { startMode: 'on_previous_end' } },
      });
      const revision = (await aggregate()).queue.revision;
      await ok({ type: 'item.end', payload: { queueItemId: a, next: true } });
      const agg = await aggregate();
      expect(agg.queue.revision).toBe(revision + 1);
      expect(agg.queue.currentItemId).toBe(b);
      expect(agg.items.find((i) => i.id === a)?.completedAt).not.toBeNull();
      expect(agg.items.find((i) => i.id === b)?.timer?.status).toBe('running');
    });

    it('STOP is not END: stopping the timer keeps the item current and not completed', async () => {
      await timer('timer.start', a);
      await timer('timer.stop', a);
      expect(await current()).toBe(a);
      expect((await itemOf(a))?.completedAt).toBeNull();
    });

    it('a repeated END + NEXT for the same item cannot skip the next item', async () => {
      await ok({ type: 'item.end', payload: { queueItemId: a, next: true } });
      const again = await run({ type: 'item.end', payload: { queueItemId: a, next: true } });
      expect(!again.ok && again.error.code).toBe('invalid_transition');
      expect(await current()).toBe(note);
    });
  });

  describe('concurrency and idempotency', () => {
    it('rejects a stale expectedRevision', async () => {
      const revision = (await aggregate()).queue.revision;
      await add('Speaker A', MINUTE_MS);
      const stale = await run({
        type: 'item.add',
        expectedRevision: revision,
        payload: { title: 'X' },
      });
      expect(!stale.ok && stale.error.code).toBe('revision_conflict');
      const fresh = await run({
        type: 'item.add',
        expectedRevision: revision + 1,
        payload: { title: 'X' },
      });
      expect(fresh.ok).toBe(true);
    });

    it('replays an idempotent retry instead of applying it twice', async () => {
      const body: QueueCommandDto = cmd({
        type: 'item.add',
        idempotencyKey: 'retry-key-1',
        payload: { title: 'Once' },
      });
      const first = await executeQueueCommand(showId, body, owner, deps);
      const second = await executeQueueCommand(showId, body, owner, deps);
      expect(second).toEqual(first);
      expect((await aggregate()).items.filter((i) => i.title === 'Once')).toHaveLength(1);
      const reused = await executeQueueCommand(
        showId,
        { ...body, payload: { title: 'Other' } } as QueueCommandDto,
        owner,
        deps,
      );
      expect(!reused.ok && reused.error.code).toBe('idempotency_conflict');
    });

    it('re-evaluates against fresh state when a timer transition races the save', async () => {
      await timer('timer.start', timerItem);
      // Simulate a timer transition committed between load and save of the END command.
      const realLoad = store.loadQueue.bind(store);
      let raced = false;
      store.loadQueue = async (id) => {
        const loaded = await realLoad(id);
        if (!raced) {
          raced = true;
          await timer('timer.pause', timerItem);
        }
        return loaded;
      };
      const out = await ok({ type: 'item.end', payload: { queueItemId: timerItem, next: false } });
      const item = out.aggregate.items.find((i) => i.id === timerItem);
      // The END was applied on top of the paused timer (revision 2), never overwriting it.
      expect(item?.timer?.status).toBe('stopped');
      expect(item?.timer?.revision).toBe(3);
    });
  });

  describe('permissions', () => {
    it('a board share can never mutate the Queue', async () => {
      const bodies: Body[] = [
        { type: 'item.add', payload: { title: 'x' } },
        { type: 'queue.setCurrent', payload: { queueItemId: timerItem } },
        { type: 'item.end', payload: { queueItemId: timerItem, next: true } },
        {
          type: 'show.setWarning',
          payload: { warning: { kind: 'percent', warningPercent: 10, criticalPercent: 5 } },
        },
      ];
      for (const body of bodies) {
        const result = await run(body, board);
        expect(!result.ok && result.error.code).toBe('forbidden');
      }
      expect((await aggregate()).queue.revision).toBe(0);
    });

    it('an owner of another Show cannot change this Queue', async () => {
      const other = await createQuickTimer({ durationMs: MINUTE_MS }, deps);
      if (!other.ok) throw new Error('setup');
      const intruder = await authenticateToken(other.value.ownerToken, 'owner', deps);
      if (!intruder) throw new Error('setup');
      const result = await run(
        { type: 'item.add', payload: { title: 'x' } },
        { actor: intruder.actor },
      );
      expect(!result.ok && result.error.code).toBe('forbidden');
    });
  });

  describe('warning inheritance', () => {
    it('Show default -> Queue override -> Item override, with reset to inherited', async () => {
      const queueRule = {
        kind: 'absolute',
        warningMs: 5 * MINUTE_MS,
        criticalMs: MINUTE_MS,
      } as const;
      const itemRule = { kind: 'percent', warningPercent: 50, criticalPercent: 10 } as const;
      await ok({ type: 'queue.setWarning', payload: { warning: queueRule } });
      await ok({ type: 'item.setWarning', payload: { queueItemId: timerItem, warning: itemRule } });
      await ok({
        type: 'show.setWarning',
        payload: { warning: { kind: 'percent', warningPercent: 25, criticalPercent: 5 } },
      });
      const agg = await aggregate();
      expect(agg.showWarning).toMatchObject({ warningPercent: 25 });
      expect(store.shows.get(showId)?.warning).toMatchObject({ warningPercent: 25 });
      expect(agg.queue.warning).toEqual(queueRule);
      expect(agg.items[0]?.warning).toEqual(itemRule);
      await ok({ type: 'item.setWarning', payload: { queueItemId: timerItem, warning: null } });
      expect((await aggregate()).items[0]?.warning).toBeNull();
    });
  });
});
