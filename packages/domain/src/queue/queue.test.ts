import { describe, expect, it } from 'vitest';
import { BoardId, QueueId, QueueItemId, ShowId, type GroupId } from '../ids';
import type { Result } from '../result';
import { createQuickTimerShow } from '../show';
import { MINUTE_MS } from '../time';
import { DEFAULT_TIMER_THRESHOLDS, deriveTimer, startTimer, type TimerThresholds } from '../timer';
import type { QueueAggregate } from './model';
import {
  addGroup,
  addItem,
  deleteGroup,
  deleteItem,
  duplicateGroup,
  duplicateItem,
  endItem,
  moveGroup,
  moveItem,
  renameGroup,
  setCurrent,
  setItemActive,
  setItemWarning,
  setQueueWarning,
  setShowWarning,
  updateItem,
  type AddItemInput,
  type OperationContext,
} from './operations';
import { layoutOf, lifecycleOf, nextItem, orderedItems } from './order';
import { resolveItemThresholds, resolveQueueThresholds, validateThresholds } from './thresholds';

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`unexpected error: ${JSON.stringify(result.error)}`);
  return result.value;
}

let n = 0;
let now = 1_000;
const ctx = (): OperationContext => ({
  now,
  newId: () => `00000000-0000-4000-8000-${(++n).toString(16).padStart(12, '0')}`,
});

/** Quick Timer Show whose single item "Timer" is current. */
function quickShow(): QueueAggregate {
  const created = unwrap(
    createQuickTimerShow(
      {
        showId: ShowId('show'),
        queueId: QueueId('queue'),
        queueItemId: QueueItemId('timer'),
        boardId: BoardId('board'),
      },
      10 * MINUTE_MS,
      now,
    ),
  );
  return {
    showId: created.show.id,
    showWarning: created.show.warning,
    queue: created.queue,
    groups: [],
    items: [created.item],
  };
}

function add(agg: QueueAggregate, input: AddItemInput) {
  const { aggregate, itemId } = unwrap(addItem(agg, input, ctx()));
  return [aggregate, itemId] as const;
}

const titles = (agg: QueueAggregate) => orderedItems(agg).map((i) => i.title);

/** The rundown from the M2 brief: Opening, Speaker A (current), inactive note, Speaker B. */
function rundown() {
  let agg = quickShow();
  agg = unwrap(updateItem(agg, { id: QueueItemId('timer'), patch: { title: 'Opening' } }, ctx()));
  const [withA, a] = add(agg, { title: 'Speaker A', durationMs: 10 * MINUTE_MS });
  const [withNote, note] = add(withA, { title: 'Technical note', active: false });
  const [withB, b] = add(withNote, { title: 'Speaker B', durationMs: 15 * MINUTE_MS });
  agg = withB;
  agg = unwrap(setCurrent(agg, { id: a }, ctx()));
  return { agg, a, note, b, opening: QueueItemId('timer') };
}

describe('ordering', () => {
  it('appends items and keeps dense positions', () => {
    const { agg } = rundown();
    expect(titles(agg)).toEqual(['Opening', 'Speaker A', 'Technical note', 'Speaker B']);
    expect(orderedItems(agg).map((i) => i.position)).toEqual([0, 1, 2, 3]);
  });

  it('inserts at an index and moves items within the Queue', () => {
    const base = rundown();
    let agg = base.agg;
    const { b } = base;
    [agg] = add(agg, { title: 'Intro', index: 0 });
    expect(titles(agg)[0]).toBe('Intro');
    agg = unwrap(moveItem(agg, { id: b, groupId: null, index: 1 }, ctx()));
    expect(titles(agg)).toEqual(['Intro', 'Speaker B', 'Opening', 'Speaker A', 'Technical note']);
  });

  it('a no-op move does not create a new revision', () => {
    const { agg, a } = rundown();
    const moved = unwrap(moveItem(agg, { id: a, groupId: null, index: 1 }, ctx()));
    expect(moved).toBe(agg);
  });

  it('every accepted change increments the Queue revision by one', () => {
    const { agg, b } = rundown();
    const before = agg.queue.revision;
    const moved = unwrap(moveItem(agg, { id: b, groupId: null, index: 0 }, ctx()));
    expect(moved.queue.revision).toBe(before + 1);
  });
});

describe('current, next and active/inactive', () => {
  it('next skips inactive items (brief example)', () => {
    const { agg, a, b } = rundown();
    expect(agg.queue.currentItemId).toBe(a);
    expect(nextItem(agg)?.id).toBe(b);
  });

  it('next skips completed items and is the first eligible item without a current', () => {
    const { agg, opening } = rundown();
    const noCurrent = { ...agg, queue: { ...agg.queue, currentItemId: null } };
    expect(nextItem(noCurrent)?.id).toBe(opening);
  });

  it('there is no next after the last eligible item', () => {
    const { agg, b } = rundown();
    expect(nextItem(unwrap(setCurrent(agg, { id: b }, ctx())))).toBeNull();
  });

  it('activating an item makes it the next one again', () => {
    const { agg, note } = rundown();
    const active = unwrap(setItemActive(agg, { id: note, active: true }, ctx()));
    expect(nextItem(active)?.id).toBe(note);
  });

  it('the current item cannot be made inactive or deleted', () => {
    const { agg, a } = rundown();
    expect(setItemActive(agg, { id: a, active: false }, ctx())).toMatchObject({
      ok: false,
      error: { code: 'invalid_transition' },
    });
    expect(deleteItem(agg, { id: a }, ctx())).toMatchObject({
      ok: false,
      error: { code: 'invalid_transition' },
    });
  });

  it('an inactive item cannot become current', () => {
    const { agg, note } = rundown();
    expect(setCurrent(agg, { id: note }, ctx())).toMatchObject({ ok: false });
  });

  it('set current never touches timers', () => {
    const base = rundown();
    let agg = base.agg;
    const { a, b } = base;
    const item = agg.items.find((i) => i.id === a);
    if (!item?.timer) throw new Error('setup');
    const running = unwrap(startTimer(item.timer, now));
    agg = { ...agg, items: agg.items.map((i) => (i.id === a ? { ...i, timer: running } : i)) };
    agg = unwrap(setCurrent(agg, { id: b }, ctx()));
    expect(agg.items.find((i) => i.id === a)?.timer?.status).toBe('running');
    expect(agg.items.find((i) => i.id === b)?.timer?.status).toBe('idle');
  });
});

describe('Queue Item lifecycle', () => {
  it('derives upcoming / current / completed / inactive', () => {
    const { agg, opening, a, note, b } = rundown();
    const ended = unwrap(endItem(agg, { id: a, advance: true }, ctx())).aggregate;
    const life = (id: QueueItemId) => {
      const item = ended.items.find((i) => i.id === id);
      if (!item) throw new Error('missing');
      return lifecycleOf(ended, item);
    };
    expect(life(opening)).toBe('upcoming');
    expect(life(a)).toBe('completed');
    expect(life(note)).toBe('inactive');
    expect(life(b)).toBe('current');
  });

  it('a completed item that becomes current again is live (not completed)', () => {
    const { agg, a } = rundown();
    const ended = unwrap(endItem(agg, { id: a, advance: true }, ctx())).aggregate;
    const again = unwrap(setCurrent(ended, { id: a }, ctx()));
    expect(again.items.find((i) => i.id === a)?.completedAt).toBeNull();
  });
});

describe('END / END + NEXT (Queue Item command, not a timer command)', () => {
  it('END on an item without timer completes it and keeps it current', () => {
    const base = rundown();
    let agg = base.agg;
    const { note } = base;
    agg = unwrap(setItemActive(agg, { id: note, active: true }, ctx()));
    agg = unwrap(setCurrent(agg, { id: note }, ctx()));
    const out = unwrap(endItem(agg, { id: note, advance: false }, ctx()));
    const item = out.aggregate.items.find((i) => i.id === note);
    expect(item?.timer).toBeNull();
    expect(item?.completedAt).toBe(now);
    expect(out.aggregate.queue.currentItemId).toBe(note);
    expect(out.startedNext).toBe(false);
  });

  it('END on a stopped timer leaves the timer untouched', () => {
    const base = rundown();
    let agg = base.agg;
    const { a } = base;
    const item = agg.items.find((i) => i.id === a);
    if (!item?.timer) throw new Error('setup');
    const running = unwrap(startTimer(item.timer, now));
    const stopped = { ...running, status: 'stopped' as const, stoppedAt: now + 1_000 };
    agg = { ...agg, items: agg.items.map((i) => (i.id === a ? { ...i, timer: stopped } : i)) };
    const out = unwrap(endItem(agg, { id: a, advance: false }, ctx()));
    expect(out.aggregate.items.find((i) => i.id === a)?.timer).toBe(stopped);
  });

  it('END on a running timer stops (freezes) it as part of END', () => {
    const base = rundown();
    let agg = base.agg;
    const { a } = base;
    const item = agg.items.find((i) => i.id === a);
    if (!item?.timer) throw new Error('setup');
    const running = unwrap(startTimer(item.timer, now));
    agg = { ...agg, items: agg.items.map((i) => (i.id === a ? { ...i, timer: running } : i)) };
    now += 90_000;
    const out = unwrap(endItem(agg, { id: a, advance: false }, ctx()));
    const timer = out.aggregate.items.find((i) => i.id === a)?.timer;
    expect(timer?.status).toBe('stopped');
    expect(timer?.stoppedAt).toBe(now);
    // Frozen: the value no longer changes with time.
    if (!timer) throw new Error('timer');
    expect(deriveTimer(timer, now + 60_000).remainingMs).toBe(10 * MINUTE_MS - 90_000);
  });

  it('END + NEXT completes current, skips inactive and selects the next without starting it', () => {
    const { agg, a, b } = rundown();
    const out = unwrap(endItem(agg, { id: a, advance: true }, ctx()));
    expect(out.currentItemId).toBe(b);
    expect(out.aggregate.queue.currentItemId).toBe(b);
    expect(out.aggregate.items.find((i) => i.id === b)?.timer?.status).toBe('idle');
    expect(out.startedNext).toBe(false);
    expect(out.aggregate.queue.revision).toBe(agg.queue.revision + 1);
  });

  it('END + NEXT starts the next timer only when its start mode asks for it', () => {
    const base = rundown();
    let agg = base.agg;
    const { a, b } = base;
    agg = unwrap(updateItem(agg, { id: b, patch: { startMode: 'on_previous_end' } }, ctx()));
    const out = unwrap(endItem(agg, { id: a, advance: true }, ctx()));
    const next = out.aggregate.items.find((i) => i.id === b);
    expect(next?.timer?.status).toBe('running');
    expect(next?.timer?.startedAt).toBe(now);
    expect(out.startedNext).toBe(true);
  });

  it('END + NEXT on the last item leaves no current item', () => {
    const base = rundown();
    let agg = base.agg;
    const { b } = base;
    agg = unwrap(setCurrent(agg, { id: b }, ctx()));
    const out = unwrap(endItem(agg, { id: b, advance: true }, ctx()));
    expect(out.aggregate.queue.currentItemId).toBeNull();
  });

  it('only the current item can be ended (a repeated END + NEXT cannot skip an item)', () => {
    const { agg, a } = rundown();
    const first = unwrap(endItem(agg, { id: a, advance: true }, ctx())).aggregate;
    expect(endItem(first, { id: a, advance: true }, ctx())).toMatchObject({
      ok: false,
      error: { code: 'invalid_transition' },
    });
  });
});

describe('item editing', () => {
  it('update changes fields, bumps the item revision and normalizes tags', () => {
    const { agg, a } = rundown();
    const before = agg.items.find((i) => i.id === a);
    const updated = unwrap(
      updateItem(
        agg,
        {
          id: a,
          patch: {
            title: '  Jan  ',
            subtitle: 'CEO',
            notes: 'Headset 3',
            tags: ['#VIP', 'vip', ' keynote '],
          },
        },
        ctx(),
      ),
    );
    const item = updated.items.find((i) => i.id === a);
    expect(item).toMatchObject({
      title: 'Jan',
      subtitle: 'CEO',
      notes: 'Headset 3',
      tags: ['vip', 'keynote'],
    });
    expect(item?.revision).toBe((before?.revision ?? 0) + 1);
  });

  it('an unchanged update is a no-op', () => {
    const { agg, a } = rundown();
    expect(unwrap(updateItem(agg, { id: a, patch: { title: 'Speaker A' } }, ctx()))).toBe(agg);
  });

  it('adds, reconfigures and removes a timer; refuses while running', () => {
    const base = rundown();
    let agg = base.agg;
    const { note, a } = base;
    agg = unwrap(updateItem(agg, { id: note, patch: { durationMs: 5 * MINUTE_MS } }, ctx()));
    expect(agg.items.find((i) => i.id === note)?.timer?.durationMs).toBe(5 * MINUTE_MS);
    agg = unwrap(updateItem(agg, { id: note, patch: { durationMs: null } }, ctx()));
    expect(agg.items.find((i) => i.id === note)?.timer).toBeNull();

    const item = agg.items.find((i) => i.id === a);
    if (!item?.timer) throw new Error('setup');
    const running = unwrap(startTimer(item.timer, now));
    agg = { ...agg, items: agg.items.map((i) => (i.id === a ? { ...i, timer: running } : i)) };
    expect(updateItem(agg, { id: a, patch: { durationMs: MINUTE_MS } }, ctx())).toMatchObject({
      ok: false,
    });
    expect(updateItem(agg, { id: a, patch: { durationMs: null } }, ctx())).toMatchObject({
      ok: false,
    });
  });

  it('rejects an empty title', () => {
    expect(addItem(quickShow(), { title: '   ' }, ctx())).toMatchObject({
      ok: false,
      error: { code: 'validation_failed' },
    });
  });

  it('duplicate inserts a fresh copy directly after the original', () => {
    const { agg, a } = rundown();
    const ended = unwrap(endItem(agg, { id: a, advance: true }, ctx())).aggregate;
    const { aggregate, itemId } = unwrap(duplicateItem(ended, { id: a }, ctx()));
    expect(titles(aggregate)).toEqual([
      'Opening',
      'Speaker A',
      'Speaker A',
      'Technical note',
      'Speaker B',
    ]);
    const copy = aggregate.items.find((i) => i.id === itemId);
    expect(copy?.completedAt).toBeNull();
    expect(copy?.timer?.status).toBe('idle');
    expect(copy?.timer?.durationMs).toBe(10 * MINUTE_MS);
  });

  it('deletes a non-current item', () => {
    const { agg, opening } = rundown();
    expect(titles(unwrap(deleteItem(agg, { id: opening }, ctx())))).toEqual([
      'Speaker A',
      'Technical note',
      'Speaker B',
    ]);
  });
});

describe('Groups (one level: Group -> Queue Items)', () => {
  function grouped() {
    const base = rundown();
    let agg = base.agg;
    const added = unwrap(addGroup(agg, { title: 'Morning', index: 1 }, ctx()));
    agg = added.aggregate;
    const group: GroupId = added.groupId;
    agg = unwrap(moveItem(agg, { id: base.a, groupId: group, index: 0 }, ctx()));
    agg = unwrap(moveItem(agg, { id: base.note, groupId: group, index: 1 }, ctx()));
    return { ...base, agg, group };
  }

  it('group children appear in place in the operational order', () => {
    const { agg, group, a, note, b } = grouped();
    expect(titles(agg)).toEqual(['Opening', 'Speaker A', 'Technical note', 'Speaker B']);
    expect(layoutOf(agg)).toEqual([
      { kind: 'item', id: QueueItemId('timer') },
      { kind: 'group', id: group, items: [a, note] },
      { kind: 'item', id: b },
    ]);
  });

  it('next follows the order across the group boundary and skips inactive children', () => {
    const { agg, b } = grouped();
    expect(nextItem(agg)?.id).toBe(b);
  });

  it('moving a group moves its children with it', () => {
    const { agg, group } = grouped();
    const moved = unwrap(moveGroup(agg, { id: group, index: 99 }, ctx()));
    expect(titles(moved)).toEqual(['Opening', 'Speaker B', 'Speaker A', 'Technical note']);
  });

  it('duplicating a group copies its children with fresh ids', () => {
    const { agg, group } = grouped();
    const { aggregate, groupId } = unwrap(duplicateGroup(agg, { id: group }, ctx()));
    expect(titles(aggregate)).toEqual([
      'Opening',
      'Speaker A',
      'Technical note',
      'Speaker A',
      'Technical note',
      'Speaker B',
    ]);
    const copies = aggregate.items.filter((i) => i.groupId === groupId);
    expect(copies).toHaveLength(2);
    expect(copies.every((c) => !agg.items.some((i) => i.id === c.id))).toBe(true);
  });

  it('items move out of a group to the top level', () => {
    const { agg, a } = grouped();
    const out = unwrap(moveItem(agg, { id: a, groupId: null, index: 0 }, ctx()));
    expect(out.items.find((i) => i.id === a)?.groupId).toBeNull();
    expect(titles(out)[0]).toBe('Speaker A');
  });

  it('a group containing the current item cannot be deleted; otherwise children go with it', () => {
    const { agg, group, b } = grouped();
    expect(deleteGroup(agg, { id: group }, ctx())).toMatchObject({ ok: false });
    const elsewhere = unwrap(setCurrent(agg, { id: b }, ctx()));
    const deleted = unwrap(deleteGroup(elsewhere, { id: group }, ctx()));
    expect(titles(deleted)).toEqual(['Opening', 'Speaker B']);
    expect(deleted.groups).toHaveLength(0);
  });

  it('renames a group', () => {
    const { agg, group } = grouped();
    expect(unwrap(renameGroup(agg, { id: group, title: 'Ochtend' }, ctx())).groups[0]?.title).toBe(
      'Ochtend',
    );
  });
});

describe('warning inheritance: Show default -> Queue override -> Queue Item override', () => {
  const queueRule: TimerThresholds = {
    kind: 'absolute',
    warningMs: 5 * MINUTE_MS,
    criticalMs: MINUTE_MS,
  };
  const itemRule: TimerThresholds = { kind: 'percent', warningPercent: 30, criticalPercent: 10 };

  it('falls back to the KLOCKR Show default', () => {
    expect(resolveItemThresholds(DEFAULT_TIMER_THRESHOLDS, null, null)).toEqual({
      rule: DEFAULT_TIMER_THRESHOLDS,
      source: 'show',
      inherited: { rule: DEFAULT_TIMER_THRESHOLDS, source: 'show' },
    });
  });

  it('a Queue override wins over the Show default', () => {
    expect(resolveItemThresholds(DEFAULT_TIMER_THRESHOLDS, queueRule, null)).toMatchObject({
      rule: queueRule,
      source: 'queue',
    });
    expect(resolveQueueThresholds(DEFAULT_TIMER_THRESHOLDS, queueRule).inherited.source).toBe(
      'show',
    );
  });

  it('an Item override wins and reports what it would inherit', () => {
    expect(resolveItemThresholds(DEFAULT_TIMER_THRESHOLDS, queueRule, itemRule)).toEqual({
      rule: itemRule,
      source: 'item',
      inherited: { rule: queueRule, source: 'queue' },
    });
  });

  it('overrides are set and reset through Queue operations', () => {
    const base = rundown();
    let agg = base.agg;
    const { a } = base;
    agg = unwrap(setQueueWarning(agg, { warning: queueRule }));
    agg = unwrap(setItemWarning(agg, { id: a, warning: itemRule }, ctx()));
    expect(agg.items.find((i) => i.id === a)?.warning).toEqual(itemRule);
    agg = unwrap(setItemWarning(agg, { id: a, warning: null }, ctx()));
    expect(agg.items.find((i) => i.id === a)?.warning).toBeNull();
    agg = unwrap(setQueueWarning(agg, { warning: null }));
    expect(agg.queue.warning).toBeNull();
    agg = unwrap(setShowWarning(agg, { warning: itemRule }));
    expect(agg.showWarning).toEqual(itemRule);
  });

  it('validates rules', () => {
    expect(validateThresholds({ kind: 'percent', warningPercent: 5, criticalPercent: 20 }).ok).toBe(
      false,
    );
    expect(
      validateThresholds({ kind: 'percent', warningPercent: 120, criticalPercent: 5 }).ok,
    ).toBe(false);
    expect(validateThresholds({ kind: 'absolute', warningMs: -1, criticalMs: 0 }).ok).toBe(false);
    expect(validateThresholds(queueRule).ok).toBe(true);
  });
});
