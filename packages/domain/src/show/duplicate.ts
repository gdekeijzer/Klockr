import type { Board } from '../board';
import { BoardId, GroupId, QueueId, QueueItemId, type ShowId } from '../ids';
import type { QueueItem } from '../queue';
import type { Relation } from '../relation';
import type { EpochMs } from '../time';
import type { TimerState } from '../timer';
import type { ShowAggregate } from './aggregate';

/**
 * Explicit Show duplication (M5): the same content in another Room is a NEW Show, never a shared
 * one (runtime state cannot be in two physical places at once).
 *
 * Copied (configuration): Queues incl. order, discipline, Primary, warning and timing overrides;
 * Groups; Queue Items (title, subtitle, notes, tags, active, start mode, warning override,
 * planning: planned start/duration, fixed anchor; audiences/visibility); timer configuration
 * (mode, duration); relations (remapped); Show Boards with their configuration (remapped
 * sources); Show warning and schedule defaults.
 *
 * NOT copied (runtime/history/credentials): running/paused/stopped timer state and
 * adjustments, actual start/end, completed state, Current, pending suggestions, Messages,
 * locks and unlock requests, audit history, Board share tokens, Device credentials. The new
 * Show starts clean and idle; its revision starts at 0.
 */
export function duplicateShow(
  source: ShowAggregate,
  input: {
    readonly showId: ShowId;
    readonly title: string;
    readonly newId: () => string;
    readonly now: EpochMs;
  },
): ShowAggregate {
  const { now } = input;
  const queueIds = new Map<string, QueueId>();
  const groupIds = new Map<string, GroupId>();
  const itemIds = new Map<string, QueueItemId>();
  for (const q of source.queues) {
    queueIds.set(q.queue.id, QueueId(input.newId()));
    for (const g of q.groups) groupIds.set(g.id, GroupId(input.newId()));
    for (const i of q.items) itemIds.set(i.id, QueueItemId(input.newId()));
  }
  const mapped = <T extends string>(map: Map<string, T>, id: string): T => {
    const value = map.get(id);
    if (value === undefined) throw new Error(`duplicate: unmapped id ${id}`);
    return value;
  };

  const idleTimer = (t: TimerState): TimerState => ({
    mode: t.mode,
    status: 'idle',
    durationMs: t.durationMs,
    adjustmentMs: 0,
    startedAt: null,
    pausedAt: null,
    pausedTotalMs: 0,
    stoppedAt: null,
    revision: 0,
  });

  const queues = source.queues.map((q) => {
    const queueId = mapped(queueIds, q.queue.id);
    return {
      queue: {
        ...q.queue,
        id: queueId,
        showId: input.showId,
        currentItemId: null,
        revision: 0,
      },
      groups: q.groups.map((g) => ({
        ...g,
        id: mapped(groupIds, g.id),
        queueId,
        createdAt: now,
        updatedAt: now,
      })),
      items: q.items.map((i): QueueItem => ({
        ...i,
        id: mapped(itemIds, i.id),
        queueId,
        groupId: i.groupId === null ? null : mapped(groupIds, i.groupId),
        completedAt: null,
        actualStartAt: null,
        actualEndAt: null,
        timer: i.timer ? idleTimer(i.timer) : null,
        createdAt: now,
        updatedAt: now,
        revision: 0,
      })),
    };
  });

  const relations: Relation[] = source.relations.map((r) => ({
    ...r,
    id: input.newId(),
    sourceItemId: mapped(itemIds, r.sourceItemId),
    targetItemId: mapped(itemIds, r.targetItemId),
    createdAt: now,
    updatedAt: now,
    revision: 0,
  }));

  const boards: Board[] = source.boards.map((b) => ({
    ...b,
    id: BoardId(input.newId()),
    showId: input.showId,
    eventId: null,
    sources:
      b.sources.kind === 'selected'
        ? { kind: 'selected', queueIds: b.sources.queueIds.map((id) => mapped(queueIds, id)) }
        : b.sources,
    createdAt: now,
    updatedAt: now,
    revision: 0,
  }));

  return {
    showId: input.showId,
    title: input.title,
    revision: 0,
    primaryQueueId: mapped(queueIds, source.primaryQueueId),
    showWarning: source.showWarning,
    showSchedule: source.showSchedule,
    queues,
    locks: [],
    unlockRequests: [],
    relations,
    suggestions: [],
    boards,
    messages: [],
  };
}
