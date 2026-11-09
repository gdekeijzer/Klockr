import type {
  BoardConfigDto,
  BoardItem,
  BoardQueue,
  BoardStateSnapshot,
  MessageSnapshot,
  QueueItemSnapshot,
  QueueSnapshot,
  ShowStateSnapshot,
} from '@klockr/contracts';
import {
  areNotesVisibleTo,
  boardSourceQueues,
  calculateShowSchedule,
  isEligible,
  isItemVisibleTo,
  isMessageActive,
  lifecycleOf,
  messagesFor,
  nextItem,
  orderedItems,
  queueView,
  resolveItemThresholds,
  resolveQueueThresholds,
  showEffectiveLock,
  type Board,
  type EpochMs,
  type ItemSchedule,
  type Message,
  type QueueAggregate,
  type QueueItem,
  type Show,
  type ShowAggregate,
} from '@klockr/domain';
import { toTimerSnapshot } from '../timer';

function itemSnapshot(agg: QueueAggregate, item: QueueItem, now: EpochMs): QueueItemSnapshot {
  return {
    id: item.id,
    groupId: item.groupId,
    title: item.title,
    subtitle: item.subtitle,
    notes: item.notes,
    tags: [...item.tags],
    position: item.position,
    active: item.active,
    completedAt: item.completedAt,
    lifecycle: lifecycleOf(agg, item),
    startMode: item.startMode,
    warning: item.warning,
    effectiveWarning: resolveItemThresholds(agg.showWarning, agg.queue.warning, item.warning),
    timer: item.timer ? toTimerSnapshot(item.id, item.timer, now) : null,
    plannedStartAt: item.plannedStartAt,
    plannedDurationMs: item.plannedDurationMs,
    fixedAnchor: item.fixedAnchor,
    actualStartAt: item.actualStartAt,
    actualEndAt: item.actualEndAt,
    visibility: item.visibility === null ? null : [...item.visibility],
    notesAudiences: [...item.notesAudiences],
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    revision: item.revision,
  };
}

/** Management projection of one Queue: items in operational order, derived current/next. */
export function toQueueSnapshot(
  agg: QueueAggregate,
  now: EpochMs,
  primaryQueueId: string = agg.queue.id,
): QueueSnapshot {
  return {
    id: agg.queue.id,
    showId: agg.showId,
    name: agg.queue.name,
    discipline: agg.queue.discipline,
    position: agg.queue.position,
    isPrimary: agg.queue.id === primaryQueueId,
    revision: agg.queue.revision,
    currentItemId: agg.queue.currentItemId,
    nextItemId: nextItem(agg)?.id ?? null,
    showWarning: agg.showWarning,
    warning: agg.queue.warning,
    effectiveWarning: resolveQueueThresholds(agg.showWarning, agg.queue.warning),
    showSchedule: agg.showSchedule,
    timingMode: agg.queue.timingMode,
    locks: agg.locks.map((l) => ({ ...l, target: { ...l.target }, lockedBy: { ...l.lockedBy } })),
    unlockRequests: agg.unlockRequests.map((r) => ({
      ...r,
      target: { ...r.target },
      requestedBy: { ...r.requestedBy },
    })),
    groups: [...agg.groups]
      .sort((a, b) => a.position - b.position)
      .map((g) => ({ id: g.id, title: g.title, position: g.position })),
    items: orderedItems(agg).map((item) => itemSnapshot(agg, item, now)),
    serverTime: now,
  };
}

export function toBoardConfig(board: Board): BoardConfigDto {
  return {
    id: board.id,
    name: board.name,
    preset: board.preset,
    audience: board.audience,
    sources:
      board.sources.kind === 'primary'
        ? { kind: 'primary' }
        : { kind: 'queues', queueIds: [...board.sources.queueIds] },
    components: board.components.map((c) => ({ ...c })),
    presentation: { ...board.presentation },
    revision: board.revision,
  };
}

function messageSnapshot(m: Message): MessageSnapshot {
  return {
    id: m.id,
    text: m.text,
    audiences: [...m.audiences],
    boardIds: [...m.boardIds],
    priority: m.priority,
    createdAt: m.createdAt,
    expiresAt: m.expiresAt,
  };
}

/** Management projection of the whole Show (Operator, Master, Boards admin). */
export function toShowStateSnapshot(
  meta: Show,
  show: ShowAggregate,
  now: EpochMs,
): ShowStateSnapshot {
  return {
    show: {
      id: meta.id,
      title: meta.title,
      ownership: meta.ownership,
      createdAt: meta.createdAt,
      expiresAt: meta.expiresAt,
      revision: show.revision,
      primaryQueueId: show.primaryQueueId,
    },
    queues: show.queues.flatMap((q) => {
      const view = queueView(show, q.queue.id);
      return view ? [toQueueSnapshot(view, now, show.primaryQueueId)] : [];
    }),
    relations: show.relations.map((r) => ({
      id: r.id,
      sourceItemId: r.sourceItemId,
      targetItemId: r.targetItemId,
      offsetMs: r.offsetMs,
      preserveOffset: r.preserveOffset,
      active: r.active,
      revision: r.revision,
    })),
    suggestions: show.suggestions
      .filter((s) => s.status === 'pending')
      .map((s) => ({
        id: s.id,
        relationId: s.relationId,
        sourceQueueId: s.sourceQueueId,
        sourceItemId: s.sourceItemId,
        targetQueueId: s.targetQueueId,
        targetItemId: s.targetItemId,
        createdAt: s.createdAt,
        status: s.status,
      })),
    boards: show.boards.map(toBoardConfig),
    messages: show.messages.filter((m) => isMessageActive(m, now)).map(messageSnapshot),
    serverTime: now,
  };
}

/** Projected end of a running countdown (after it the schedule grows 1:1 with time). */
function growsAfter(item: QueueItem | undefined): EpochMs | null {
  const t = item?.timer;
  if (t?.status !== 'running' || t.mode !== 'countdown' || t.startedAt === null) return null;
  return t.startedAt + t.pausedTotalMs + t.durationMs + t.adjustmentMs;
}

/**
 * Read-only Board projection, scoped SERVER-SIDE: only the Board's source Queues; only items
 * visible to the Board's audience; notes only when the Board enables a Notes component AND the
 * item explicitly publishes its notes to that audience; no audit, locks details, credentials or
 * management data. Hidden items still take their time in the schedule (projected values are
 * computed on the full Show) but their content never leaves the server.
 */
export function toBoardSnapshot(board: Board, show: ShowAggregate, now: EpochMs): BoardStateSnapshot {
  const schedule = calculateShowSchedule(show, now);
  const audience = board.audience;
  const enabled = new Set(board.components.filter((c) => c.enabled).map((c) => c.kind));
  const upcomingCount = Math.max(
    1,
    ...board.components
      .filter((c) => c.enabled && ['agenda', 'next_item', 'queue_current_next'].includes(c.kind))
      .map((c) => c.upcoming),
  );

  const queues: BoardQueue[] = boardSourceQueues(board, show.primaryQueueId).flatMap((queueId) => {
    const view = queueView(show, queueId);
    if (!view) return [];
    const projection = schedule.queues.get(queueId);
    const scheduleOf = new Map<string, ItemSchedule>(projection?.items.map((i) => [i.id, i]) ?? []);
    const visible = (i: QueueItem) => isItemVisibleTo(i, audience);
    const toItem = (i: QueueItem): BoardItem => {
      const s = scheduleOf.get(i.id);
      return {
        id: i.id,
        title: i.title,
        subtitle: i.subtitle,
        durationMs: i.timer?.durationMs ?? i.plannedDurationMs,
        plannedStart: s?.plannedStart ?? null,
        projectedStart: s?.projectedStart ?? null,
        fixedAnchor: i.fixedAnchor,
      };
    };
    const ordered = orderedItems(view);
    const currentIndex = ordered.findIndex((i) => i.id === view.queue.currentItemId);
    const current = currentIndex >= 0 ? ordered[currentIndex] : undefined;
    const after = ordered.slice(currentIndex + 1).filter((i) => isEligible(i) && visible(i));
    const currentVisible = current !== undefined && visible(current);
    const timers = [
      ...(currentVisible && current.timer ? [current] : []),
      ...ordered.filter(
        (i) =>
          i !== current &&
          visible(i) &&
          (i.timer?.status === 'running' || i.timer?.status === 'paused'),
      ),
    ].flatMap((i) => (i.timer ? [toTimerSnapshot(i.id, i.timer, now)] : []));
    const anchorItem = projection?.nextAnchor
      ? ordered.find((i) => i.id === projection.nextAnchor?.itemId)
      : undefined;
    const pending = show.suggestions.find(
      (s) => s.status === 'pending' && s.targetQueueId === queueId,
    );
    const suggested = pending ? ordered.find((i) => i.id === pending.targetItemId) : undefined;
    return [
      {
        id: view.queue.id,
        name: view.queue.name,
        discipline: view.queue.discipline,
        isPrimary: view.queue.id === show.primaryQueueId,
        current: currentVisible ? toItem(current) : null,
        currentNotes:
          enabled.has('notes') && currentVisible && areNotesVisibleTo(current, audience)
            ? current.notes
            : null,
        next: after[0] ? toItem(after[0]) : null,
        upcoming: after.slice(0, upcomingCount).map(toItem),
        timers,
        warning: resolveItemThresholds(show.showWarning, view.queue.warning, current?.warning ?? null)
          .rule,
        offsetMs: projection?.showOffsetMs ?? null,
        growsAfter: growsAfter(current),
        toleranceMs: show.showSchedule.toleranceMs,
        severeBehindMs: show.showSchedule.severeBehindMs,
        anchor:
          projection?.nextAnchor && anchorItem && visible(anchorItem)
            ? {
                title: anchorItem.title,
                plannedStart: projection.nextAnchor.plannedStart,
                recoveryMs: projection.nextAnchor.recoveryMs,
                recoverableMs: projection.nextAnchor.recoverableMs,
              }
            : null,
        locked: showEffectiveLock(show, { kind: 'queue', id: view.queue.id }) !== null,
        suggestion:
          pending && suggested && visible(suggested)
            ? {
                id: pending.id,
                targetTitle: suggested.title,
                sourceQueueName:
                  show.queues.find((q) => q.queue.id === pending.sourceQueueId)?.queue.name ?? '',
              }
            : null,
      },
    ];
  });

  return {
    board: {
      id: board.id,
      name: board.name,
      preset: board.preset,
      audience,
      components: board.components.map((c) => ({ ...c })),
      presentation: { ...board.presentation },
    },
    version: show.revision,
    timeZone: show.showSchedule.timeZone,
    queues,
    messages: messagesFor(show.messages, board, now).map(messageSnapshot),
    serverTime: now,
  };
}
