import { GroupId, QueueItemId } from '../ids';
import { err, ok, type Result } from '../result';
import type { DurationMs, EpochMs } from '../time';
import {
  configureTimer,
  createTimer,
  startTimer,
  stopTimer,
  type TimerMode,
  type TimerState,
  type TimerThresholds,
} from '../timer';
import {
  QUEUE_LIMITS,
  type Group,
  type QueueAggregate,
  type QueueItem,
  type StartMode,
} from './model';
import {
  applyLayout,
  currentItem,
  findGroup,
  findItem,
  layoutOf,
  nextItem,
  type Layout,
  type LayoutEntry,
} from './order';
import { validateThresholds } from './thresholds';

/**
 * Pure Queue operations. Each returns a new aggregate with `queue.revision + 1`, or a typed
 * error; nothing is mutated and no clock is read (the caller passes `now`).
 */
export type QueueError =
  | { readonly code: 'not_found'; readonly reason: string }
  | { readonly code: 'invalid_transition'; readonly reason: string }
  | { readonly code: 'validation_failed'; readonly reason: string };

export type QueueResult<T = QueueAggregate> = Result<T, QueueError>;

export interface OperationContext {
  readonly now: EpochMs;
  /** Fresh unique id (UUID) for created items/groups. */
  readonly newId: () => string;
}

const notFound = (reason: string) => err({ code: 'not_found', reason } as const);
const invalid = (reason: string) => err({ code: 'invalid_transition', reason } as const);
const badInput = (reason: string) => err({ code: 'validation_failed', reason } as const);

function commit(agg: QueueAggregate): QueueAggregate {
  return { ...agg, queue: { ...agg.queue, revision: agg.queue.revision + 1 } };
}

function touchItem(item: QueueItem, patch: Partial<QueueItem>, now: EpochMs): QueueItem {
  return { ...item, ...patch, updatedAt: now, revision: item.revision + 1 };
}

function replaceItem(agg: QueueAggregate, item: QueueItem): QueueAggregate {
  return { ...agg, items: agg.items.map((i) => (i.id === item.id ? item : i)) };
}

const isLive = (timer: TimerState | null) =>
  timer !== null && (timer.status === 'running' || timer.status === 'paused');

// ---------------------------------------------------------------------------------------------
// Input normalization
// ---------------------------------------------------------------------------------------------

function cleanTitle(value: string): Result<string, QueueError> {
  const title = value.trim();
  if (title.length === 0) return badInput('title is required');
  if (title.length > QUEUE_LIMITS.title) return badInput('title is too long');
  return ok(title);
}

function cleanOptional(
  value: string | null | undefined,
  max: number,
  field: string,
): Result<string | null, QueueError> {
  if (value === null || value === undefined) return ok(null);
  const text = field === 'notes' ? value.replace(/\s+$/u, '') : value.trim();
  if (text.trim().length === 0) return ok(null);
  if (text.length > max) return badInput(`${field} is too long`);
  return ok(text);
}

/** Tags: trimmed, leading '#' removed, lower-cased, unique, limited. */
export function normalizeTags(tags: readonly string[]): Result<string[], QueueError> {
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().replace(/^#+/u, '').toLowerCase();
    if (tag.length === 0) continue;
    if (tag.length > QUEUE_LIMITS.tag) return badInput('tag is too long');
    if (!out.includes(tag)) out.push(tag);
  }
  if (out.length > QUEUE_LIMITS.tags) return badInput('too many tags');
  return ok(out);
}

function timerFor(
  durationMs: DurationMs | null,
  mode: TimerMode = 'countdown',
): Result<TimerState | null, QueueError> {
  if (durationMs === null) return ok(null);
  const created = createTimer({ mode, durationMs });
  if (!created.ok) {
    return badInput(
      created.error.code === 'invalid_transition' ? 'invalid timer' : created.error.reason,
    );
  }
  return ok(created.value);
}

function checkThresholds(rule: TimerThresholds | null): Result<TimerThresholds | null, QueueError> {
  if (rule === null) return ok(null);
  const valid = validateThresholds(rule);
  return valid.ok ? ok(valid.value) : badInput(valid.error);
}

// ---------------------------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------------------------

function clampIndex(index: number | undefined, length: number): number {
  if (index === undefined || !Number.isInteger(index) || index > length) return length;
  return Math.max(0, index);
}

function withoutItem(layout: Layout, id: QueueItemId): LayoutEntry[] {
  return layout
    .filter((e) => !(e.kind === 'item' && e.id === id))
    .map((e) => (e.kind === 'group' ? { ...e, items: e.items.filter((i) => i !== id) } : e));
}

function insertItem(
  layout: readonly LayoutEntry[],
  id: QueueItemId,
  groupId: GroupId | null,
  index: number | undefined,
): LayoutEntry[] {
  if (groupId === null) {
    const copy = [...layout];
    copy.splice(clampIndex(index, copy.length), 0, { kind: 'item', id });
    return copy;
  }
  return layout.map((e) => {
    if (e.kind !== 'group' || e.id !== groupId) return e;
    const items = [...e.items];
    items.splice(clampIndex(index, items.length), 0, id);
    return { ...e, items };
  });
}

/** Where an item sits: its container and index in that container. */
function placementOf(layout: Layout, id: QueueItemId): { groupId: GroupId | null; index: number } {
  for (const [index, e] of layout.entries()) {
    if (e.kind === 'item' && e.id === id) return { groupId: null, index };
    if (e.kind === 'group') {
      const child = e.items.indexOf(id);
      if (child >= 0) return { groupId: e.id, index: child };
    }
  }
  return { groupId: null, index: layout.length };
}

// ---------------------------------------------------------------------------------------------
// Item operations
// ---------------------------------------------------------------------------------------------

export interface AddItemInput {
  readonly title: string;
  readonly subtitle?: string | null | undefined;
  readonly notes?: string | null | undefined;
  readonly tags?: readonly string[] | undefined;
  /** Null (or omitted) creates an item without timer, e.g. a note. */
  readonly durationMs?: DurationMs | null | undefined;
  readonly active?: boolean | undefined;
  readonly startMode?: StartMode | undefined;
  readonly groupId?: GroupId | null | undefined;
  /** Index within the container; omitted appends at the end. */
  readonly index?: number | undefined;
}

export function addItem(
  agg: QueueAggregate,
  input: AddItemInput,
  ctx: OperationContext,
): QueueResult<{ aggregate: QueueAggregate; itemId: QueueItemId }> {
  if (agg.items.length >= QUEUE_LIMITS.items) return badInput('queue has too many items');
  const groupId = input.groupId ?? null;
  if (groupId !== null && !findGroup(agg, groupId)) return notFound('group not found');
  const title = cleanTitle(input.title);
  if (!title.ok) return title;
  const subtitle = cleanOptional(input.subtitle, QUEUE_LIMITS.subtitle, 'subtitle');
  if (!subtitle.ok) return subtitle;
  const notes = cleanOptional(input.notes, QUEUE_LIMITS.notes, 'notes');
  if (!notes.ok) return notes;
  const tags = normalizeTags(input.tags ?? []);
  if (!tags.ok) return tags;
  const timer = timerFor(input.durationMs ?? null);
  if (!timer.ok) return timer;

  const id = QueueItemId(ctx.newId());
  const item: QueueItem = {
    id,
    queueId: agg.queue.id,
    groupId,
    title: title.value,
    subtitle: subtitle.value,
    notes: notes.value,
    tags: tags.value,
    position: 0,
    active: input.active ?? true,
    completedAt: null,
    startMode: input.startMode ?? 'manual',
    warning: null,
    timer: timer.value,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    revision: 0,
  };
  const withItem = { ...agg, items: [...agg.items, item] };
  const layout = insertItem(layoutOf(agg), id, groupId, input.index);
  return ok({ aggregate: commit(applyLayout(withItem, layout, ctx.now)), itemId: id });
}

export interface ItemPatch {
  readonly title?: string | undefined;
  readonly subtitle?: string | null | undefined;
  readonly notes?: string | null | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly startMode?: StartMode | undefined;
  /**
   * Timer duration. `null` removes the timer (only when it is not running/paused); a number
   * creates a countdown or reconfigures an idle/stopped one. Omitted: unchanged.
   */
  readonly durationMs?: DurationMs | null | undefined;
}

export function updateItem(
  agg: QueueAggregate,
  input: { readonly id: QueueItemId; readonly patch: ItemPatch },
  ctx: OperationContext,
): QueueResult {
  const item = findItem(agg, input.id);
  if (!item) return notFound('item not found');
  const { patch } = input;
  const next: { -readonly [K in keyof QueueItem]?: QueueItem[K] } = {};

  if (patch.title !== undefined) {
    const title = cleanTitle(patch.title);
    if (!title.ok) return title;
    next.title = title.value;
  }
  if (patch.subtitle !== undefined) {
    const subtitle = cleanOptional(patch.subtitle, QUEUE_LIMITS.subtitle, 'subtitle');
    if (!subtitle.ok) return subtitle;
    next.subtitle = subtitle.value;
  }
  if (patch.notes !== undefined) {
    const notes = cleanOptional(patch.notes, QUEUE_LIMITS.notes, 'notes');
    if (!notes.ok) return notes;
    next.notes = notes.value;
  }
  if (patch.tags !== undefined) {
    const tags = normalizeTags(patch.tags);
    if (!tags.ok) return tags;
    next.tags = tags.value;
  }
  if (patch.startMode !== undefined) next.startMode = patch.startMode;

  if (patch.durationMs !== undefined) {
    const timer = item.timer;
    if (patch.durationMs === null) {
      if (isLive(timer)) return invalid('stop the timer before removing it');
      next.timer = null;
    } else if (timer === null) {
      const created = timerFor(patch.durationMs);
      if (!created.ok) return created;
      next.timer = created.value;
    } else if (timer.durationMs !== patch.durationMs) {
      if (isLive(timer)) return invalid('cannot change the duration of a running timer');
      const configured = configureTimer(timer, { mode: timer.mode, durationMs: patch.durationMs });
      if (!configured.ok) {
        return badInput(
          configured.error.code === 'invalid_transition'
            ? 'invalid timer'
            : configured.error.reason,
        );
      }
      next.timer = configured.value;
    }
  }

  const changed = (Object.keys(next) as (keyof QueueItem)[]).some(
    (key) => JSON.stringify(next[key]) !== JSON.stringify(item[key]),
  );
  if (!changed) return ok(agg);
  return ok(commit(replaceItem(agg, touchItem(item, next, ctx.now))));
}

/** Delete one item. The current item and items with a running/paused timer are protected. */
export function deleteItem(
  agg: QueueAggregate,
  input: { readonly id: QueueItemId },
  ctx: OperationContext,
): QueueResult {
  const item = findItem(agg, input.id);
  if (!item) return notFound('item not found');
  if (agg.queue.currentItemId === item.id) {
    return invalid('the current item cannot be deleted; END it or make another item current');
  }
  if (isLive(item.timer)) return invalid('stop the timer before deleting the item');
  const remaining = { ...agg, items: agg.items.filter((i) => i.id !== item.id) };
  return ok(commit(applyLayout(remaining, withoutItem(layoutOf(agg), item.id), ctx.now)));
}

/** A fresh copy of an item: new id, not completed, idle timer with the same configuration. */
function copyItem(item: QueueItem, groupId: GroupId | null, ctx: OperationContext): QueueItem {
  const timer = item.timer
    ? createTimer({ mode: item.timer.mode, durationMs: item.timer.durationMs })
    : null;
  return {
    ...item,
    id: QueueItemId(ctx.newId()),
    groupId,
    completedAt: null,
    timer: timer?.ok ? timer.value : null,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    revision: 0,
  };
}

/** Duplicate an item directly after the original, in the same container. */
export function duplicateItem(
  agg: QueueAggregate,
  input: { readonly id: QueueItemId },
  ctx: OperationContext,
): QueueResult<{ aggregate: QueueAggregate; itemId: QueueItemId }> {
  const item = findItem(agg, input.id);
  if (!item) return notFound('item not found');
  if (agg.items.length >= QUEUE_LIMITS.items) return badInput('queue has too many items');
  const copy = copyItem(item, item.groupId, ctx);
  const layout = layoutOf(agg);
  const at = placementOf(layout, item.id);
  const nextLayout = insertItem(layout, copy.id, at.groupId, at.index + 1);
  const withCopy = { ...agg, items: [...agg.items, copy] };
  return ok({ aggregate: commit(applyLayout(withCopy, nextLayout, ctx.now)), itemId: copy.id });
}

/**
 * Move an item to `index` within a container (a Group, or the top level with `groupId: null`).
 * Moving never changes current/next state by itself; `next` is simply re-derived.
 */
export function moveItem(
  agg: QueueAggregate,
  input: { readonly id: QueueItemId; readonly groupId: GroupId | null; readonly index: number },
  ctx: OperationContext,
): QueueResult {
  if (!findItem(agg, input.id)) return notFound('item not found');
  if (input.groupId !== null && !findGroup(agg, input.groupId)) return notFound('group not found');
  const layout = insertItem(
    withoutItem(layoutOf(agg), input.id),
    input.id,
    input.groupId,
    input.index,
  );
  const moved = applyLayout(agg, layout, ctx.now);
  return ok(moved.items.every((i, n) => i === agg.items[n]) ? agg : commit(moved));
}

/** Set active/inactive. The current item cannot be deactivated (END it first). */
export function setItemActive(
  agg: QueueAggregate,
  input: { readonly id: QueueItemId; readonly active: boolean },
  ctx: OperationContext,
): QueueResult {
  const item = findItem(agg, input.id);
  if (!item) return notFound('item not found');
  if (item.active === input.active) return ok(agg);
  if (!input.active && agg.queue.currentItemId === item.id) {
    return invalid('the current item cannot be made inactive');
  }
  return ok(commit(replaceItem(agg, touchItem(item, { active: input.active }, ctx.now))));
}

/** Item-level warning override; `null` resets to the inherited (Queue/Show) value. */
export function setItemWarning(
  agg: QueueAggregate,
  input: { readonly id: QueueItemId; readonly warning: TimerThresholds | null },
  ctx: OperationContext,
): QueueResult {
  const item = findItem(agg, input.id);
  if (!item) return notFound('item not found');
  const warning = checkThresholds(input.warning);
  if (!warning.ok) return warning;
  return ok(commit(replaceItem(agg, touchItem(item, { warning: warning.value }, ctx.now))));
}

// ---------------------------------------------------------------------------------------------
// Current / END / NEXT
// ---------------------------------------------------------------------------------------------

/**
 * Make an item current (operator decision, e.g. jump or re-run). Does not start, stop or
 * otherwise touch any timer: a timer still running on the previous current keeps running.
 * A completed item that becomes current is live again (completedAt cleared).
 */
export function setCurrent(
  agg: QueueAggregate,
  input: { readonly id: QueueItemId },
  ctx: OperationContext,
): QueueResult {
  const item = findItem(agg, input.id);
  if (!item) return notFound('item not found');
  if (!item.active) return invalid('an inactive item cannot become current; activate it first');
  if (agg.queue.currentItemId === item.id) return ok(agg);
  const live = item.completedAt === null ? item : touchItem(item, { completedAt: null }, ctx.now);
  const updated = replaceItem(agg, live);
  return ok(commit({ ...updated, queue: { ...updated.queue, currentItemId: item.id } }));
}

export interface EndItemOutcome {
  readonly aggregate: QueueAggregate;
  readonly endedItemId: QueueItemId;
  /** Current after the command (the next item for END + NEXT, unchanged for END). */
  readonly currentItemId: QueueItemId | null;
  /** True only when END + NEXT started the next item's timer because of its start mode. */
  readonly startedNext: boolean;
}

/**
 * END ITEM — a Queue Item command, not a timer command (TIMER_ENGINE.md, FUNCTIONAL_DESIGN §19).
 *
 * - `id` must be the current item; this makes END safe against double clicks and stale views
 *   (a second END + NEXT can never skip a further item).
 * - Allowed whatever the timer does, and for items without a timer.
 * - The item is marked completed. A running or paused timer is STOPPED as part of END, which
 *   freezes its value (the timer has no `ended` state; `stopped` is final until a restart).
 *   An idle or stopped timer is left untouched.
 * - `advance: false` (END): the item stays current, completed. Nothing else happens.
 * - `advance: true` (END + NEXT): the next eligible item becomes current (null at the end of
 *   the Queue). Its timer starts only when its start mode is `on_previous_end` — never implicitly.
 *
 * All of it is one aggregate change, persisted atomically.
 */
export function endItem(
  agg: QueueAggregate,
  input: { readonly id: QueueItemId; readonly advance: boolean },
  ctx: OperationContext,
): QueueResult<EndItemOutcome> {
  const item = findItem(agg, input.id);
  if (!item) return notFound('item not found');
  const current = currentItem(agg);
  if (current?.id !== item.id) return invalid('only the current item can be ended');

  let timer = item.timer;
  if (timer && isLive(timer)) {
    const stopped = stopTimer(timer, ctx.now);
    if (stopped.ok) timer = stopped.value;
  }
  const ended = touchItem(item, { completedAt: item.completedAt ?? ctx.now, timer }, ctx.now);
  let result = replaceItem(agg, ended);

  if (!input.advance) {
    return ok({
      aggregate: commit(result),
      endedItemId: item.id,
      currentItemId: item.id,
      startedNext: false,
    });
  }

  const next = nextItem(result);
  let startedNext = false;
  if (next) {
    let nextTimer = next.timer;
    if (
      next.startMode === 'on_previous_end' &&
      nextTimer &&
      (nextTimer.status === 'idle' || nextTimer.status === 'stopped')
    ) {
      const started = startTimer(nextTimer, ctx.now);
      if (started.ok) {
        nextTimer = started.value;
        startedNext = true;
      }
    }
    if (nextTimer !== next.timer)
      result = replaceItem(result, touchItem(next, { timer: nextTimer }, ctx.now));
  }
  const currentItemId = next?.id ?? null;
  return ok({
    aggregate: commit({ ...result, queue: { ...result.queue, currentItemId } }),
    endedItemId: item.id,
    currentItemId,
    startedNext,
  });
}

// ---------------------------------------------------------------------------------------------
// Groups (one level: Group -> Queue Items)
// ---------------------------------------------------------------------------------------------

export function addGroup(
  agg: QueueAggregate,
  input: { readonly title: string; readonly index?: number | undefined },
  ctx: OperationContext,
): QueueResult<{ aggregate: QueueAggregate; groupId: GroupId }> {
  if (agg.groups.length >= QUEUE_LIMITS.groups) return badInput('queue has too many groups');
  const title = cleanTitle(input.title);
  if (!title.ok) return title;
  const id = GroupId(ctx.newId());
  const group: Group = {
    id,
    queueId: agg.queue.id,
    title: title.value,
    position: 0,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
  const layout = [...layoutOf(agg)];
  layout.splice(clampIndex(input.index, layout.length), 0, { kind: 'group', id, items: [] });
  const withGroup = { ...agg, groups: [...agg.groups, group] };
  return ok({ aggregate: commit(applyLayout(withGroup, layout, ctx.now)), groupId: id });
}

export function renameGroup(
  agg: QueueAggregate,
  input: { readonly id: GroupId; readonly title: string },
  ctx: OperationContext,
): QueueResult {
  const group = findGroup(agg, input.id);
  if (!group) return notFound('group not found');
  const title = cleanTitle(input.title);
  if (!title.ok) return title;
  if (title.value === group.title) return ok(agg);
  return ok(
    commit({
      ...agg,
      groups: agg.groups.map((g) =>
        g.id === group.id ? { ...g, title: title.value, updatedAt: ctx.now } : g,
      ),
    }),
  );
}

/** Delete a Group with its child items; protected while it contains current or live items. */
export function deleteGroup(
  agg: QueueAggregate,
  input: { readonly id: GroupId },
  ctx: OperationContext,
): QueueResult {
  const group = findGroup(agg, input.id);
  if (!group) return notFound('group not found');
  const children = agg.items.filter((i) => i.groupId === group.id);
  if (children.some((i) => i.id === agg.queue.currentItemId)) {
    return invalid('the group contains the current item');
  }
  if (children.some((i) => isLive(i.timer))) return invalid('the group contains a running timer');
  const remaining = {
    ...agg,
    groups: agg.groups.filter((g) => g.id !== group.id),
    items: agg.items.filter((i) => i.groupId !== group.id),
  };
  const layout = layoutOf(agg).filter((e) => !(e.kind === 'group' && e.id === group.id));
  return ok(commit(applyLayout(remaining, layout, ctx.now)));
}

/** Duplicate a Group with fresh copies of its children, directly after the original. */
export function duplicateGroup(
  agg: QueueAggregate,
  input: { readonly id: GroupId },
  ctx: OperationContext,
): QueueResult<{ aggregate: QueueAggregate; groupId: GroupId }> {
  const group = findGroup(agg, input.id);
  if (!group) return notFound('group not found');
  if (agg.groups.length >= QUEUE_LIMITS.groups) return badInput('queue has too many groups');
  const layout = layoutOf(agg);
  const index = layout.findIndex((e) => e.kind === 'group' && e.id === group.id);
  const source = layout[index];
  const childIds = source?.kind === 'group' ? source.items : [];
  if (agg.items.length + childIds.length > QUEUE_LIMITS.items) {
    return badInput('queue has too many items');
  }
  const id = GroupId(ctx.newId());
  const copies = childIds
    .map((childId) => findItem(agg, childId))
    .filter((i): i is QueueItem => i !== undefined)
    .map((child) => copyItem(child, id, ctx));
  const copyGroup: Group = { ...group, id, createdAt: ctx.now, updatedAt: ctx.now };
  const nextLayout = [...layout];
  nextLayout.splice(index + 1, 0, { kind: 'group', id, items: copies.map((c) => c.id) });
  const withCopy = {
    ...agg,
    groups: [...agg.groups, copyGroup],
    items: [...agg.items, ...copies],
  };
  return ok({ aggregate: commit(applyLayout(withCopy, nextLayout, ctx.now)), groupId: id });
}

/** Move a Group (with all its children) to a top-level index. */
export function moveGroup(
  agg: QueueAggregate,
  input: { readonly id: GroupId; readonly index: number },
  ctx: OperationContext,
): QueueResult {
  if (!findGroup(agg, input.id)) return notFound('group not found');
  const layout = layoutOf(agg);
  const entry = layout.find((e) => e.kind === 'group' && e.id === input.id);
  if (!entry) return notFound('group not found');
  const rest = layout.filter((e) => e !== entry);
  rest.splice(clampIndex(input.index, rest.length), 0, entry);
  const moved = applyLayout(agg, rest, ctx.now);
  const unchanged =
    moved.groups.every((g, n) => g === agg.groups[n]) &&
    moved.items.every((i, n) => i === agg.items[n]);
  return ok(unchanged ? agg : commit(moved));
}

// ---------------------------------------------------------------------------------------------
// Inherited settings
// ---------------------------------------------------------------------------------------------

/** Queue-level warning override; `null` resets to the Show default. */
export function setQueueWarning(
  agg: QueueAggregate,
  input: { readonly warning: TimerThresholds | null },
): QueueResult {
  const warning = checkThresholds(input.warning);
  if (!warning.ok) return warning;
  return ok(commit({ ...agg, queue: { ...agg.queue, warning: warning.value } }));
}

/** Show default warning thresholds (top of the chain; always set). */
export function setShowWarning(
  agg: QueueAggregate,
  input: { readonly warning: TimerThresholds },
): QueueResult {
  const valid = validateThresholds(input.warning);
  if (!valid.ok) return badInput(valid.error);
  return ok(commit({ ...agg, showWarning: valid.value }));
}
