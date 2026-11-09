import type { Board } from '../board';
import { QueueId, type QueueItemId, type ShowId } from '../ids';
import type { Lock, UnlockRequest } from '../lock';
import type { Message } from '../message';
import type { Group, Queue, QueueAggregate, QueueItem } from '../queue/model';
import type { Relation, Suggestion } from '../relation';
import { err, ok, type Result } from '../result';
import type { ShowSchedule } from '../schedule/settings';
import type { EpochMs } from '../time';
import type { TimerThresholds } from '../timer';

/**
 * Consistency boundary since M4: one Show with all its peer Queues (each with Groups and
 * Items), locks, cross-Queue relations, pending suggestions, Boards and Messages. One
 * compare-and-set revision for the whole Show makes cross-Queue transitions atomic (e.g.
 * END + NEXT in Program plus the suggestions it creates in Audio). Each Queue keeps its own
 * revision for client gating and `expectedRevision` checks.
 *
 * Queue operations from M2/M3 stay single-Queue functions: they run on `queueView()` and are
 * written back with `withQueueView()`.
 */
export interface QueueState {
  readonly queue: Queue;
  readonly groups: readonly Group[];
  readonly items: readonly QueueItem[];
}

export interface ShowAggregate {
  readonly showId: ShowId;
  readonly title: string;
  /** Show-level compare-and-set revision (+1 per accepted command). */
  readonly revision: number;
  readonly primaryQueueId: QueueId;
  readonly showWarning: TimerThresholds;
  readonly showSchedule: ShowSchedule;
  /** Ordered by `queue.position`. */
  readonly queues: readonly QueueState[];
  readonly locks: readonly Lock[];
  readonly unlockRequests: readonly UnlockRequest[];
  readonly relations: readonly Relation[];
  /** Pending suggestions (plus ones resolved by the current command, until saved). */
  readonly suggestions: readonly Suggestion[];
  readonly boards: readonly Board[];
  /** Messages not cleared (expired ones may linger until housekeeping; filter by time). */
  readonly messages: readonly Message[];
}

export function findQueue(show: ShowAggregate, queueId: string): QueueState | undefined {
  return show.queues.find((q) => q.queue.id === queueId);
}

export function queueOfItem(show: ShowAggregate, itemId: string): QueueState | undefined {
  return show.queues.find((q) => q.items.some((i) => i.id === itemId));
}

export function itemById(show: ShowAggregate, itemId: string): QueueItem | undefined {
  for (const q of show.queues) {
    const found = q.items.find((i) => i.id === itemId);
    if (found) return found;
  }
  return undefined;
}

export function primaryQueue(show: ShowAggregate): QueueState {
  const primary = findQueue(show, show.primaryQueueId) ?? show.queues[0];
  if (!primary) throw new Error('a Show always has at least one Queue');
  return primary;
}

/** Single-Queue view (the M2/M3 `QueueAggregate`) for running Queue operations. */
export function queueView(show: ShowAggregate, queueId: string): QueueAggregate | null {
  const state = findQueue(show, queueId);
  if (!state) return null;
  return {
    showId: show.showId,
    showWarning: show.showWarning,
    showSchedule: show.showSchedule,
    locks: show.locks,
    unlockRequests: show.unlockRequests,
    queue: state.queue,
    groups: state.groups,
    items: state.items,
  };
}

/**
 * Write a (possibly changed) Queue view back. Unchanged view -> same Show object. A changed
 * view bumps the Show revision (the view's own operation already bumped the Queue revision).
 */
export function withQueueView(show: ShowAggregate, view: QueueAggregate): ShowAggregate {
  const before = queueView(show, view.queue.id);
  if (
    before &&
    before.queue === view.queue &&
    before.groups === view.groups &&
    before.items === view.items &&
    before.locks === view.locks &&
    before.unlockRequests === view.unlockRequests &&
    before.showWarning === view.showWarning &&
    before.showSchedule === view.showSchedule
  ) {
    return show;
  }
  return {
    ...show,
    revision: show.revision + 1,
    showWarning: view.showWarning,
    showSchedule: view.showSchedule,
    locks: view.locks,
    unlockRequests: view.unlockRequests,
    queues: show.queues.map((q) =>
      q.queue.id === view.queue.id
        ? { queue: view.queue, groups: view.groups, items: view.items }
        : q,
    ),
  };
}

/** Bump the Show revision (for Show-level changes that do not go through a Queue view). */
export function commitShow(show: ShowAggregate): ShowAggregate {
  return { ...show, revision: show.revision + 1 };
}

export type ShowError =
  | { readonly code: 'not_found'; readonly reason: string }
  | { readonly code: 'invalid_transition'; readonly reason: string }
  | { readonly code: 'validation_failed'; readonly reason: string };

export type ShowResult<T = ShowAggregate> = Result<T, ShowError>;

const notFound = (reason: string) => err({ code: 'not_found', reason } as const);
const invalid = (reason: string) => err({ code: 'invalid_transition', reason } as const);
const badInput = (reason: string) => err({ code: 'validation_failed', reason } as const);

export { badInput as showBadInput, invalid as showInvalid, notFound as showNotFound };

function renumber(queues: readonly QueueState[]): QueueState[] {
  return queues.map((q, position) =>
    q.queue.position === position ? q : { ...q, queue: { ...q.queue, position } },
  );
}

const MAX_QUEUES = 20;

function cleanName(name: string): Result<string, ShowError> {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 60)
    return badInput('queue name must be 1-60 characters');
  return ok(trimmed);
}

function cleanDiscipline(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length === 0 ? null : trimmed.slice(0, 40);
}

/** Add a peer Queue at the end (or at `index`). */
export function addQueue(
  show: ShowAggregate,
  input: {
    readonly name: string;
    readonly discipline?: string | null | undefined;
    readonly index?: number | undefined;
  },
  ctx: { readonly newId: () => string },
): ShowResult<{ show: ShowAggregate; queueId: QueueId }> {
  if (show.queues.length >= MAX_QUEUES) return badInput('a Show has at most 20 Queues');
  const name = cleanName(input.name);
  if (!name.ok) return name;
  const id = QueueId(ctx.newId());
  const state: QueueState = {
    queue: {
      id,
      showId: show.showId,
      name: name.value,
      discipline: cleanDiscipline(input.discipline),
      position: 0,
      currentItemId: null,
      warning: null,
      timingMode: null,
      revision: 0,
    },
    groups: [],
    items: [],
  };
  const list = [...show.queues];
  const index =
    input.index === undefined ? list.length : Math.max(0, Math.min(list.length, input.index));
  list.splice(index, 0, state);
  return ok({ show: commitShow({ ...show, queues: renumber(list) }), queueId: id });
}

export function updateQueue(
  show: ShowAggregate,
  input: {
    readonly queueId: string;
    readonly name?: string | undefined;
    readonly discipline?: string | null | undefined;
  },
): ShowResult {
  const state = findQueue(show, input.queueId);
  if (!state) return notFound('queue not found');
  let queue = state.queue;
  if (input.name !== undefined) {
    const name = cleanName(input.name);
    if (!name.ok) return name;
    queue = { ...queue, name: name.value };
  }
  if (input.discipline !== undefined)
    queue = { ...queue, discipline: cleanDiscipline(input.discipline) };
  if (queue.name === state.queue.name && queue.discipline === state.queue.discipline)
    return ok(show);
  queue = { ...queue, revision: queue.revision + 1 };
  return ok(
    commitShow({
      ...show,
      queues: show.queues.map((q) => (q.queue.id === queue.id ? { ...q, queue } : q)),
    }),
  );
}

export function moveQueue(
  show: ShowAggregate,
  input: { readonly queueId: string; readonly index: number },
): ShowResult {
  const from = show.queues.findIndex((q) => q.queue.id === input.queueId);
  if (from < 0) return notFound('queue not found');
  const list = [...show.queues];
  const [moved] = list.splice(from, 1);
  if (!moved) return notFound('queue not found');
  const to = Math.max(0, Math.min(list.length, input.index));
  if (to === from) return ok(show);
  list.splice(to, 0, moved);
  return ok(commitShow({ ...show, queues: renumber(list) }));
}

/** Primary = default source for Show-level projections; never a parent of other Queues. */
export function setPrimaryQueue(show: ShowAggregate, queueId: string): ShowResult {
  if (!findQueue(show, queueId)) return notFound('queue not found');
  if (show.primaryQueueId === queueId) return ok(show);
  return ok(commitShow({ ...show, primaryQueueId: QueueId(queueId) }));
}

/**
 * Delete a Queue — only when safe: never the Primary Queue (choose another Primary first), never
 * with a running/paused timer or a live Current (END it or clear it first). Everything that
 * referenced the Queue (relations, suggestions, locks, Board sources) is removed with it, so no
 * dangling data remains.
 */
export function deleteQueue(show: ShowAggregate, queueId: string, now: EpochMs): ShowResult {
  const state = findQueue(show, queueId);
  if (!state) return notFound('queue not found');
  if (show.primaryQueueId === queueId)
    return invalid('the Primary Queue cannot be deleted; make another Queue Primary first');
  if (state.items.some((i) => i.timer?.status === 'running' || i.timer?.status === 'paused')) {
    return invalid('the Queue has a running timer');
  }
  const current = state.items.find((i) => i.id === state.queue.currentItemId);
  const started =
    current && (current.actualStartAt !== null || (current.timer?.status ?? 'idle') !== 'idle');
  if (current && current.completedAt === null && started) {
    return invalid('the Queue has a live Current item; END it first');
  }
  const remaining = {
    ...show,
    queues: renumber(show.queues.filter((q) => q.queue.id !== queueId)),
  };
  return ok(commitShow(normalizeShow(remaining, now)));
}

/**
 * Remove references that no longer resolve (after deleting Queues/Items/Groups or moving items):
 * relations with a missing end or with both ends in the same Queue, suggestions of missing
 * relations/items, locks on missing targets, Board sources of missing Queues. Messages for
 * deleted Boards keep their audiences.
 */
export function normalizeShow(show: ShowAggregate, _now: EpochMs): ShowAggregate {
  const queueIds = new Set(show.queues.map((q) => q.queue.id as string));
  const itemQueue = new Map<string, string>();
  const groupIds = new Set<string>();
  for (const q of show.queues) {
    for (const i of q.items) itemQueue.set(i.id, q.queue.id);
    for (const g of q.groups) groupIds.add(g.id);
  }
  const relations = show.relations.filter((r) => {
    const a = itemQueue.get(r.sourceItemId);
    const b = itemQueue.get(r.targetItemId);
    return a !== undefined && b !== undefined && a !== b;
  });
  const relationIds = new Set(relations.map((r) => r.id));
  const suggestions = show.suggestions.filter(
    (s) =>
      s.status !== 'pending' ||
      (relationIds.has(s.relationId) && itemQueue.get(s.targetItemId) === s.targetQueueId),
  );
  const locks = show.locks.filter((l) => {
    switch (l.target.kind) {
      case 'show':
        return true;
      case 'queue':
        return queueIds.has(l.target.id);
      case 'group':
        return groupIds.has(l.target.id);
      case 'item':
        return itemQueue.has(l.target.id);
    }
  });
  const lockIds = new Set(locks.map((l) => l.id));
  const boards = show.boards.map((b) => {
    if (b.sources.kind !== 'selected') return b;
    const kept = b.sources.queueIds.filter((id) => queueIds.has(id));
    if (kept.length === b.sources.queueIds.length) return b;
    return {
      ...b,
      sources:
        kept.length > 0
          ? { kind: 'selected' as const, queueIds: kept }
          : { kind: 'primary' as const },
      revision: b.revision + 1,
    };
  });
  const same =
    relations.length === show.relations.length &&
    suggestions.length === show.suggestions.length &&
    locks.length === show.locks.length &&
    boards.every((b, n) => b === show.boards[n]);
  if (same) return show;
  return {
    ...show,
    relations,
    suggestions,
    locks,
    unlockRequests: show.unlockRequests.filter((r) => lockIds.has(r.lockId)),
    boards,
  };
}

export type { QueueItemId };

// --- Locks across Queues ------------------------------------------------------------------------

import { effectiveLock, type EffectiveLock } from '../lock/effective';
import type { LockTarget } from '../lock/lock';

/** Effective lock of a target anywhere in the Show (resolves the target's own Queue). */
export function showEffectiveLock(show: ShowAggregate, target: LockTarget): EffectiveLock | null {
  let queueId: string | undefined;
  switch (target.kind) {
    case 'show':
      queueId = show.primaryQueueId;
      break;
    case 'queue':
      queueId = target.id;
      break;
    case 'group':
      queueId = show.queues.find((q) => q.groups.some((g) => g.id === target.id))?.queue.id;
      break;
    case 'item':
      queueId = queueOfItem(show, target.id)?.queue.id;
      break;
  }
  const view = queueId ? queueView(show, queueId) : null;
  return view ? effectiveLock(view, target) : null;
}

export function showFirstLock(
  show: ShowAggregate,
  targets: readonly LockTarget[],
): EffectiveLock | null {
  for (const target of targets) {
    const found = showEffectiveLock(show, target);
    if (found) return found;
  }
  return null;
}
