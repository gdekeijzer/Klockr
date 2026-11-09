import { describe, expect, it } from 'vitest';
import { BoardId, QueueId, QueueItemId, ShowId } from '../ids';
import { effectiveLock, releaseLock, requestUnlock, setLock } from '../lock';
import type { QueueAggregate } from '../queue/model';
import {
  addGroup,
  addItem,
  deleteItem,
  endItem,
  moveItem,
  setCurrent,
  updateItem,
} from '../queue/operations';
import type { Result } from '../result';
import { createQuickTimerShow } from '../show';
import { MINUTE_MS, SECOND_MS } from '../time';
import { adjustTimer, startTimer, stopTimer } from '../timer';
import { calculateSchedule, classifyOffset } from './engine';
import {
  setItemSchedule,
  setQueueTimingMode,
  setShowSchedule,
  transitionItemTimer,
} from './operations';

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`unexpected error: ${JSON.stringify(result.error)}`);
  return result.value;
}

/** Wall-clock helper: 2026-11-10 hh:mm:ss UTC. */
const at = (h: number, m: number, s = 0) => Date.UTC(2026, 10, 10, h, m, s);

let n = 0;
const ctx = (now: number) => ({
  now,
  newId: () => `00000000-0000-4000-8000-${(++n).toString(16).padStart(12, '0')}`,
});
const actor = { kind: 'management_grant', id: 'owner' };

/**
 * Rundown builder: the Quick Timer item becomes the first entry; the rest are appended.
 * `start` makes an explicit planned start; the others chain.
 */
function rundown(
  entries: { title: string; min: number; start?: number; anchor?: boolean; scheduled?: boolean }[],
  mode: 'strict' | 'sliding' = 'strict',
) {
  const [first, ...rest] = entries;
  if (!first) throw new Error('empty');
  const created = unwrap(
    createQuickTimerShow(
      {
        showId: ShowId('show'),
        queueId: QueueId('queue'),
        queueItemId: QueueItemId('first'),
        boardId: BoardId('board'),
      },
      first.min * MINUTE_MS,
      0,
    ),
  );
  let agg: QueueAggregate = {
    showId: created.show.id,
    showWarning: created.show.warning,
    showSchedule: { ...created.show.schedule, timingMode: mode },
    locks: [],
    unlockRequests: [],
    queue: created.queue,
    groups: [],
    items: [created.item],
  };
  agg = unwrap(
    updateItem(agg, { id: QueueItemId('first'), patch: { title: first.title } }, ctx(0)),
  );
  const ids: Record<string, QueueItemId> = { [first.title]: QueueItemId('first') };
  for (const e of rest) {
    const out = unwrap(
      addItem(
        agg,
        {
          title: e.title,
          durationMs: e.min * MINUTE_MS,
          startMode: e.scheduled ? 'scheduled' : 'manual',
        },
        ctx(0),
      ),
    );
    agg = out.aggregate;
    ids[e.title] = out.itemId;
  }
  for (const e of entries) {
    const id = ids[e.title];
    if (id && (e.start !== undefined || e.anchor)) {
      agg = unwrap(
        setItemSchedule(
          agg,
          { id, patch: { plannedStartAt: e.start ?? null, fixedAnchor: e.anchor ?? false } },
          ctx(0),
        ),
      );
    }
  }
  const id = (title: string) => {
    const found = ids[title];
    if (!found) throw new Error(`no item ${title}`);
    return found;
  };
  return { agg, id };
}

const start = (agg: QueueAggregate, id: QueueItemId, now: number) =>
  unwrap(transitionItemTimer(agg, { id, transition: (t) => startTimer(t, now) }, { now }))
    .aggregate;
const endNext = (agg: QueueAggregate, id: QueueItemId, now: number) =>
  unwrap(endItem(agg, { id, advance: true }, ctx(now))).aggregate;
const item = (agg: QueueAggregate, now: number, id: QueueItemId) => {
  const found = calculateSchedule(agg, now).items.find((i) => i.id === id);
  if (!found) throw new Error('missing schedule item');
  return found;
};

/** Example 19/20: Opening 09:00 10m, A 20m, B 20m, Break 15m; A starts 09:14. */
function morning(mode: 'strict' | 'sliding') {
  const r = rundown(
    [
      { title: 'Opening', min: 10, start: at(9, 0) },
      { title: 'Speaker A', min: 20 },
      { title: 'Speaker B', min: 20 },
      { title: 'Break', min: 15 },
    ],
    mode,
  );
  let agg = start(r.agg, r.id('Opening'), at(9, 0));
  agg = endNext(agg, r.id('Opening'), at(9, 14));
  agg = start(agg, r.id('Speaker A'), at(9, 14));
  return { ...r, agg };
}

describe('planned chain', () => {
  it('chains planned starts from the explicit first start and the durations', () => {
    const { agg, id } = morning('strict');
    expect(item(agg, at(9, 15), id('Speaker B'))).toMatchObject({
      plannedStart: at(9, 30),
      plannedEnd: at(9, 50),
      explicitStart: false,
    });
    expect(item(agg, at(9, 15), id('Break')).plannedStart).toBe(at(9, 50));
  });

  it('Planned stays immutable during live shifts (start late, adjust, END)', () => {
    const r = morning('sliding');
    const before = calculateSchedule(r.agg, at(9, 15)).items.map((i) => [
      i.plannedStart,
      i.plannedEnd,
    ]);
    const timer = r.agg.items.find((i) => i.id === r.id('Speaker A'))?.timer;
    if (!timer) throw new Error('timer');
    let agg = unwrap(
      transitionItemTimer(
        r.agg,
        { id: r.id('Speaker A'), transition: (t) => adjustTimer(t, 5 * MINUTE_MS, at(9, 16)) },
        { now: at(9, 16) },
      ),
    ).aggregate;
    agg = endNext(agg, r.id('Speaker A'), at(9, 40));
    const after = calculateSchedule(agg, at(9, 41)).items.map((i) => [
      i.plannedStart,
      i.plannedEnd,
    ]);
    expect(after).toEqual(before);
    expect(
      agg.items.every(
        (i) => i.plannedStartAt === r.agg.items.find((x) => x.id === i.id)?.plannedStartAt,
      ),
    ).toBe(true);
  });
});

describe('Strict (example 19)', () => {
  it('Speaker B planned 09:30 stays, projected 09:34, Show +04:00 BEHIND', () => {
    const { agg, id } = morning('strict');
    const now = at(9, 15);
    const s = calculateSchedule(agg, now);
    expect(item(agg, now, id('Speaker B'))).toMatchObject({
      plannedStart: at(9, 30),
      projectedStart: at(9, 34),
    });
    expect(s.showOffsetMs).toBe(4 * MINUTE_MS);
    expect(s.showOffsetBasis).toEqual({ itemId: id('Speaker A'), milestone: 'end' });
    expect(classifyOffset(s.showOffsetMs ?? 0, s.toleranceMs, s.severeBehindMs)).toBe('behind');
    expect(s.timingMode).toEqual({ mode: 'strict', source: 'show' });
  });

  it('an explicitly planned item is never projected earlier than planned when running ahead', () => {
    const r = rundown([
      { title: 'Opening', min: 10, start: at(9, 0) },
      { title: 'Speaker A', min: 20 },
      { title: 'Speaker B', min: 20, start: at(9, 30) },
    ]);
    let agg = start(r.agg, r.id('Opening'), at(9, 0));
    agg = endNext(agg, r.id('Opening'), at(9, 6));
    agg = start(agg, r.id('Speaker A'), at(9, 6));
    const strict = item(agg, at(9, 7), r.id('Speaker B'));
    expect(strict.projectedStart).toBe(at(9, 30));
    const sliding = unwrap(setQueueTimingMode(agg, 'sliding'));
    expect(item(sliding, at(9, 7), r.id('Speaker B')).projectedStart).toBe(at(9, 26));
    expect(calculateSchedule(sliding, at(9, 7)).timingMode).toEqual({
      mode: 'sliding',
      source: 'queue',
    });
  });
});

describe('Sliding (example 20)', () => {
  it('future projected times shift +04:00 while Planned stays', () => {
    const { agg, id } = morning('sliding');
    const now = at(9, 15);
    expect(item(agg, now, id('Speaker B'))).toMatchObject({
      plannedStart: at(9, 30),
      projectedStart: at(9, 34),
      startShiftMs: 4 * MINUTE_MS,
    });
    expect(item(agg, now, id('Break'))).toMatchObject({
      plannedStart: at(9, 50),
      projectedStart: at(9, 54),
      startShiftMs: 4 * MINUTE_MS,
    });
  });

  it('a live timer adjustment (+05:00) immediately moves the projection', () => {
    const { agg, id } = morning('sliding');
    const adjusted = unwrap(
      transitionItemTimer(
        agg,
        { id: id('Speaker A'), transition: (t) => adjustTimer(t, 5 * MINUTE_MS, at(9, 16)) },
        { now: at(9, 16) },
      ),
    ).aggregate;
    expect(item(adjusted, at(9, 16), id('Speaker B')).projectedStart).toBe(at(9, 39));
    expect(calculateSchedule(adjusted, at(9, 16)).showOffsetMs).toBe(9 * MINUTE_MS);
  });

  it('an overrunning current item pushes everything after it by the overtime', () => {
    const { agg, id } = morning('sliding');
    // A planned to end 09:34 (started late); at 09:36 it is 2 min into overtime.
    expect(item(agg, at(9, 36), id('Speaker B')).projectedStart).toBe(at(9, 36));
    expect(calculateSchedule(agg, at(9, 36)).showOffsetMs).toBe(6 * MINUTE_MS);
  });

  it('the projected end of a running timer is exact, even for an observer clock slightly behind', () => {
    const { agg, id } = morning('sliding');
    // A started 09:14 for 20 min; an observer at 09:13:59.940 (60 ms behind) still sees 09:34.
    expect(item(agg, at(9, 14) - 60, id('Speaker A')).projectedEnd).toBe(at(9, 34));
    expect(item(agg, at(9, 20), id('Speaker A')).projectedEnd).toBe(at(9, 34));
  });

  it('a stopped (not ENDed) current item is projected to end now', () => {
    const { agg, id } = morning('sliding');
    const stopped = unwrap(
      transitionItemTimer(
        agg,
        { id: id('Speaker A'), transition: (t) => stopTimer(t, at(9, 20)) },
        { now: at(9, 20) },
      ),
    ).aggregate;
    expect(item(stopped, at(9, 22), id('Speaker A')).projectedEnd).toBe(at(9, 22));
  });
});

describe('ahead / on time / behind (±30 s tolerance)', () => {
  const tol = 30 * SECOND_MS;
  const severe = 5 * MINUTE_MS;
  it.each([
    [4 * MINUTE_MS, 'behind'],
    [7 * MINUTE_MS, 'severe'],
    [-4 * MINUTE_MS, 'ahead'],
    [30 * SECOND_MS, 'on_time'],
    [-30 * SECOND_MS, 'on_time'],
    [31 * SECOND_MS, 'behind'],
    [-31 * SECOND_MS, 'ahead'],
    [0, 'on_time'],
    [6 * MINUTE_MS, 'severe'],
  ] as const)('offset %d ms -> %s', (offset, status) => {
    expect(classifyOffset(offset, tol, severe)).toBe(status);
  });

  it('hysteresis: once BEHIND it does not flicker back to ON TIME just under the edge', () => {
    expect(classifyOffset(25 * SECOND_MS, tol, severe, 'behind')).toBe('behind');
    expect(classifyOffset(19 * SECOND_MS, tol, severe, 'behind')).toBe('on_time');
    expect(classifyOffset(25 * SECOND_MS, tol, severe, 'on_time')).toBe('on_time');
    expect(classifyOffset(-25 * SECOND_MS, tol, severe, 'ahead')).toBe('ahead');
  });

  it('ahead: Opening ends early, Show is AHEAD', () => {
    const r = rundown([
      { title: 'Opening', min: 10, start: at(9, 0) },
      { title: 'Speaker A', min: 20 },
    ]);
    let agg = start(r.agg, r.id('Opening'), at(9, 0));
    agg = endNext(agg, r.id('Opening'), at(9, 6));
    agg = start(agg, r.id('Speaker A'), at(9, 6));
    expect(calculateSchedule(agg, at(9, 7)).showOffsetMs).toBe(-4 * MINUTE_MS);
  });
});

describe('fixed anchors (example 21)', () => {
  function lunch(currentStart: number) {
    const r = rundown(
      [
        { title: 'Speaker A', min: 20, start: at(12, 20) },
        { title: 'Speaker B', min: 20 },
        { title: 'Lunch', min: 45, start: at(13, 0), anchor: true },
        { title: 'Afternoon', min: 30 },
      ],
      'sliding',
    );
    return { ...r, agg: start(r.agg, r.id('Speaker A'), currentStart) };
  }

  it('8 minutes behind: +08:00 BEHIND, Lunch stays 13:00 FIXED, 08:00 TO RECOVER (risk)', () => {
    const { agg, id } = lunch(at(12, 28));
    const s = calculateSchedule(agg, at(12, 30));
    expect(s.showOffsetMs).toBe(8 * MINUTE_MS);
    expect(s.nextAnchor).toMatchObject({
      itemId: id('Lunch'),
      plannedStart: at(13, 0),
      projectedArrival: at(13, 8),
      recoveryMs: 8 * MINUTE_MS,
      status: 'risk',
    });
    // Nothing is shortened: B keeps 20 min, Lunch keeps its plan.
    expect(item(agg, at(12, 30), id('Speaker B'))).toMatchObject({
      projectedStart: at(12, 48),
      projectedEnd: at(13, 8),
    });
    expect(item(agg, at(12, 30), id('Lunch'))).toMatchObject({
      plannedStart: at(13, 0),
      projectedStart: at(13, 8),
    });
    // Show offset and recovery are distinct values.
    expect(s.nextAnchor?.recoveryMs).toBe(s.showOffsetMs);
  });

  it('show offset and recovery differ when slack exists before the anchor', () => {
    const r = rundown(
      [
        { title: 'Speaker A', min: 20, start: at(12, 20) },
        { title: 'Lunch', min: 45, start: at(13, 0), anchor: true },
      ],
      'sliding',
    );
    const agg = start(r.agg, r.id('Speaker A'), at(12, 28));
    const s = calculateSchedule(agg, at(12, 30));
    expect(s.showOffsetMs).toBe(8 * MINUTE_MS);
    expect(s.nextAnchor).toMatchObject({ recoveryMs: 0, status: 'on_track' });
    // An early arrival never pulls the anchor earlier.
    expect(item(agg, at(12, 30), r.id('Lunch')).projectedStart).toBe(at(13, 0));
  });

  it('anchor missed/conflict when even ending everything now cannot make it', () => {
    const r = lunch(at(12, 28));
    let agg = endNext(r.agg, r.id('Speaker A'), at(12, 50));
    agg = start(agg, r.id('Speaker B'), at(12, 50));
    expect(calculateSchedule(agg, at(12, 55)).nextAnchor).toMatchObject({
      recoveryMs: 10 * MINUTE_MS,
      status: 'risk',
    });
    expect(calculateSchedule(agg, at(13, 2)).nextAnchor).toMatchObject({ status: 'missed' });
  });
});

describe('soft scheduled start (example 22)', () => {
  it('SHOULD HAVE STARTED 02:15 AGO, never auto-started, gone once current', () => {
    const r = rundown([
      { title: 'Panel', min: 30, start: at(14, 0) },
      { title: 'Keynote', min: 30, start: at(14, 30), scheduled: true },
    ]);
    const agg = start(r.agg, r.id('Panel'), at(14, 0));
    const now = at(14, 32, 15);
    expect(item(agg, now, r.id('Keynote')).shouldHaveStartedMs).toBe(
      2 * MINUTE_MS + 15 * SECOND_MS,
    );
    expect(agg.items.find((i) => i.id === r.id('Keynote'))?.timer?.status).toBe('idle');
    const current = unwrap(setCurrent(agg, { id: r.id('Keynote') }, ctx(now)));
    expect(item(current, now, r.id('Keynote')).shouldHaveStartedMs).toBeNull();
    expect(item(agg, at(14, 29), r.id('Keynote')).shouldHaveStartedMs).toBeNull();
  });

  it('only items with start mode `scheduled` warn', () => {
    const r = rundown([
      { title: 'Panel', min: 30, start: at(14, 0) },
      { title: 'Talk', min: 30, start: at(14, 30) },
    ]);
    expect(item(r.agg, at(14, 40), r.id('Talk')).shouldHaveStartedMs).toBeNull();
  });
});

describe('actual start / end', () => {
  it('first START records actualStart, restart never rewrites it, END records actualEnd', () => {
    const r = rundown([
      { title: 'A', min: 10, start: at(9, 0) },
      { title: 'B', min: 10 },
    ]);
    let agg = start(r.agg, r.id('A'), at(9, 2));
    agg = unwrap(
      transitionItemTimer(
        agg,
        { id: r.id('A'), transition: (t) => stopTimer(t, at(9, 3)) },
        { now: at(9, 3) },
      ),
    ).aggregate;
    agg = start(agg, r.id('A'), at(9, 4));
    expect(agg.items.find((i) => i.id === r.id('A'))?.actualStartAt).toBe(at(9, 2));
    agg = endNext(agg, r.id('A'), at(9, 12));
    expect(agg.items.find((i) => i.id === r.id('A'))?.actualEndAt).toBe(at(9, 12));
    expect(item(agg, at(9, 13), r.id('A'))).toMatchObject({
      actualStart: at(9, 2),
      actualEnd: at(9, 12),
    });
  });

  it('an item without timer actually starts when it becomes current', () => {
    let { agg } = rundown([{ title: 'A', min: 10, start: at(9, 0) }]);
    const note = unwrap(addItem(agg, { title: 'Note', durationMs: null }, ctx(0)));
    agg = unwrap(setCurrent(note.aggregate, { id: note.itemId }, ctx(at(9, 5))));
    expect(agg.items.find((i) => i.id === note.itemId)?.actualStartAt).toBe(at(9, 5));
  });

  it('planned schedule edits validate input', () => {
    const { agg, id } = rundown([{ title: 'A', min: 10 }]);
    expect(setItemSchedule(agg, { id: id('A'), patch: { fixedAnchor: true } }, ctx(0)).ok).toBe(
      false,
    );
    expect(setItemSchedule(agg, { id: id('A'), patch: { plannedDurationMs: 5 } }, ctx(0)).ok).toBe(
      false,
    );
    expect(setShowSchedule(agg, { timeZone: 'Mars/Olympus' }).ok).toBe(false);
    expect(
      setShowSchedule(agg, { timeZone: 'Europe/Amsterdam', scheduleDate: '2026-11-10' }).ok,
    ).toBe(true);
  });
});

describe('locks', () => {
  function locked() {
    const { agg: base, id } = rundown([
      { title: 'A', min: 10 },
      { title: 'B', min: 10 },
    ]);
    const group = unwrap(addGroup(base, { title: 'G' }, ctx(0)));
    const agg = unwrap(
      moveItem(group.aggregate, { id: id('B'), groupId: group.groupId, index: 0 }, ctx(0)),
    );
    return { agg, id, groupId: group.groupId };
  }

  it('a lock applies to its target and everything below it (inheritance)', () => {
    const { agg, id, groupId } = locked();
    const withGroupLock = unwrap(
      setLock(agg, { kind: 'group', id: groupId }, { ...ctx(1), actor }),
    ).aggregate;
    expect(effectiveLock(withGroupLock, { kind: 'item', id: id('B') })).toMatchObject({
      inheritedFrom: { kind: 'group', id: groupId },
    });
    expect(effectiveLock(withGroupLock, { kind: 'item', id: id('A') })).toBeNull();
    const withShowLock = unwrap(
      setLock(agg, { kind: 'show', id: agg.showId }, { ...ctx(1), actor }),
    ).aggregate;
    expect(effectiveLock(withShowLock, { kind: 'item', id: id('A') })?.lock.target.kind).toBe(
      'show',
    );
    expect(effectiveLock(withShowLock, { kind: 'show', id: agg.showId })?.inheritedFrom).toBeNull();
  });

  it('release removes only an own lock; an inherited lock must be released at its source', () => {
    const { agg, id } = locked();
    const queueLocked = unwrap(
      setLock(agg, { kind: 'queue', id: agg.queue.id }, { ...ctx(1), actor }),
    ).aggregate;
    expect(releaseLock(queueLocked, { kind: 'item', id: id('A') })).toMatchObject({ ok: false });
    expect(
      unwrap(releaseLock(queueLocked, { kind: 'queue', id: agg.queue.id })).aggregate.locks,
    ).toHaveLength(0);
    expect(
      setLock(queueLocked, { kind: 'queue', id: agg.queue.id }, { ...ctx(1), actor }),
    ).toMatchObject({ ok: false });
  });

  it('request unlock records the request against the effective lock; release resolves it', () => {
    const { agg, id } = locked();
    const itemLocked = unwrap(
      setLock(agg, { kind: 'item', id: id('A') }, { ...ctx(1), actor }),
    ).aggregate;
    const requested = unwrap(
      requestUnlock(itemLocked, { kind: 'item', id: id('A') }, 'need to fix typo', {
        ...ctx(2),
        actor,
      }),
    );
    expect(requested.request).toMatchObject({
      reason: 'need to fix typo',
      target: { kind: 'item', id: id('A') },
    });
    const released = unwrap(releaseLock(requested.aggregate, { kind: 'item', id: id('A') }));
    expect(released.resolvedRequests).toHaveLength(1);
    expect(released.aggregate.unlockRequests).toHaveLength(0);
    expect(
      requestUnlock(agg, { kind: 'item', id: id('A') }, null, { ...ctx(2), actor }),
    ).toMatchObject({ ok: false });
  });

  it('deleting a locked item removes its lock with it', () => {
    const base = locked();
    let agg = base.agg;
    const { id } = base;
    agg = unwrap(setLock(agg, { kind: 'item', id: id('B') }, { ...ctx(1), actor })).aggregate;
    agg = unwrap(deleteItem(agg, { id: id('B') }, ctx(2)));
    expect(agg.locks).toHaveLength(0);
  });
});
