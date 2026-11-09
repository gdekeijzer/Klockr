import type {
  BoardQueue,
  BoardStateSnapshot,
  DeviceSnapshot,
  EventShowSummary,
  EventStateSnapshot,
} from '@klockr/contracts';
import {
  calculateShowSchedule,
  compareMessages,
  deviceStatus,
  nextItem,
  orderedItems,
  queueView,
  showEffectiveLock,
  showsIn,
  type Board,
  type Device,
  type EpochMs,
  type EventAggregate,
  type ShowAggregate,
  type ShowPlacement,
} from '@klockr/domain';
import type { DevicePresence } from '../ports';
import { toBoardConfig, toBoardSnapshot } from '../queue';
import { toTimerSnapshot } from '../timer';

/** Placements in dashboard order: Rooms in their order, then the Event-without-Room bucket. */
export function orderedPlacements(agg: EventAggregate): ShowPlacement[] {
  return [...agg.rooms.flatMap((r) => showsIn(agg, r.id)), ...showsIn(agg, null)];
}

const isLive = (show: ShowAggregate): boolean =>
  show.queues.some((q) =>
    q.items.some((i) => i.timer?.status === 'running' || i.timer?.status === 'paused'),
  );

const isFinished = (show: ShowAggregate): boolean => {
  const primary = show.queues.find((q) => q.queue.id === show.primaryQueueId);
  if (!primary) return true;
  const eligible = primary.items.filter((i) => i.active);
  return eligible.length > 0 && eligible.every((i) => i.completedAt !== null);
};

/**
 * The Show a Room is "on" right now: one with a running/paused timer, else the first Show (in
 * display order) that is not finished, else the last one. Derived; never stored.
 */
export function currentShowOfRoom(
  agg: EventAggregate,
  roomId: string,
  shows: ReadonlyMap<string, ShowAggregate>,
): ShowAggregate | null {
  const list = showsIn(agg, roomId)
    .map((p) => shows.get(p.showId))
    .filter((s): s is ShowAggregate => s !== undefined);
  return list.find(isLive) ?? list.find((s) => !isFinished(s)) ?? list.at(-1) ?? null;
}

/** High-level live summary of one Show for the Event Dashboard / Room View (management only). */
export function showSummary(
  show: ShowAggregate,
  placement: ShowPlacement,
  now: EpochMs,
): EventShowSummary {
  const schedule = calculateShowSchedule(show, now);
  const view = queueView(show, show.primaryQueueId);
  const projection = schedule.queues.get(show.primaryQueueId);
  const items = view ? orderedItems(view) : [];
  const current = items.find((i) => i.id === view?.queue.currentItemId) ?? null;
  const next = view ? nextItem(view) : null;
  const scheduleOf = new Map(projection?.items.map((i) => [i.id, i]) ?? []);
  const anchorItem = projection?.nextAnchor
    ? items.find((i) => i.id === projection.nextAnchor?.itemId)
    : undefined;
  return {
    id: show.showId,
    title: show.title,
    roomId: placement.roomId,
    position: placement.position,
    timeZone: show.showSchedule.timeZone,
    revision: show.revision,
    primaryQueueName: view?.queue.name ?? 'Program',
    current: current ? { id: current.id, title: current.title, subtitle: current.subtitle } : null,
    currentTimer: current?.timer ? toTimerSnapshot(current.id, current.timer, now) : null,
    next: next
      ? {
          title: next.title,
          plannedStart: scheduleOf.get(next.id)?.plannedStart ?? null,
          projectedStart: scheduleOf.get(next.id)?.projectedStart ?? null,
        }
      : null,
    offsetMs: projection?.showOffsetMs ?? null,
    toleranceMs: show.showSchedule.toleranceMs,
    severeBehindMs: show.showSchedule.severeBehindMs,
    anchor:
      projection?.nextAnchor && anchorItem
        ? {
            title: anchorItem.title,
            plannedStart: projection.nextAnchor.plannedStart,
            recoveryMs: projection.nextAnchor.recoveryMs,
            recoverableMs: projection.nextAnchor.recoverableMs,
          }
        : null,
    runningTimers: show.queues.reduce(
      (n, q) =>
        n +
        q.items.filter((i) => i.timer?.status === 'running' || i.timer?.status === 'paused').length,
      0,
    ),
    conflicts: schedule.relations.filter((r) => r.conflict).length,
    pendingSuggestions: show.suggestions.filter((s) => s.status === 'pending').length,
    locked: showEffectiveLock(show, { kind: 'show', id: show.showId }) !== null,
    boards: show.boards.map((b) => ({ id: b.id, name: b.name, preset: b.preset })),
    agenda: items.slice(0, 100).map((i) => {
      const s = scheduleOf.get(i.id);
      return {
        id: i.id,
        title: i.title,
        plannedStart: s?.plannedStart ?? null,
        projectedStart: s?.projectedStart ?? null,
        durationMs: i.timer?.durationMs ?? i.plannedDurationMs,
        state:
          i.id === current?.id
            ? ('current' as const)
            : i.completedAt !== null
              ? ('completed' as const)
              : !i.active || s?.skipped
                ? ('skipped' as const)
                : ('upcoming' as const),
        fixedAnchor: i.fixedAnchor,
      };
    }),
  };
}

export function deviceSnapshot(
  device: Device,
  presence: DevicePresence,
  boardNames: ReadonlyMap<string, string>,
  now: EpochMs,
): DeviceSnapshot {
  return {
    id: device.id,
    name: device.name,
    status: deviceStatus(device, presence.isConnected(device.id), now),
    assignedBoardId: device.assignedBoardId,
    assignedBoardName: device.assignedBoardId
      ? (boardNames.get(device.assignedBoardId) ?? null)
      : null,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt,
    revokedAt: device.revokedAt,
    revision: device.revision,
  };
}

/** Management projection of an Event (Event Dashboard, Room View). */
export function toEventStateSnapshot(
  agg: EventAggregate,
  shows: ReadonlyMap<string, ShowAggregate>,
  devices: readonly Device[],
  presence: DevicePresence,
  now: EpochMs,
): EventStateSnapshot {
  const boardNames = new Map<string, string>([
    ...agg.boards.map((b) => [b.id, b.name] as const),
    ...[...shows.values()].flatMap((s) =>
      s.boards.map((b) => [b.id, `${s.title}: ${b.name}`] as const),
    ),
  ]);
  return {
    event: {
      id: agg.event.id,
      name: agg.event.name,
      description: agg.event.description,
      startsAt: agg.event.startsAt,
      endsAt: agg.event.endsAt,
      timeZone: agg.event.timeZone,
      status: agg.event.status,
      revision: agg.event.revision,
    },
    rooms: agg.rooms.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      position: r.position,
      status: r.status,
      locked: agg.locks.some((l) => l.target.kind === 'room' && l.target.id === r.id),
    })),
    shows: orderedPlacements(agg).flatMap((p) => {
      const show = shows.get(p.showId);
      return show ? [showSummary(show, p, now)] : [];
    }),
    boards: agg.boards.map(toBoardConfig),
    locks: agg.locks.map((l) => ({ id: l.id, target: l.target, lockedAt: l.lockedAt })),
    devices: devices.map((d) => deviceSnapshot(d, presence, boardNames, now)),
    revision: agg.revision,
    serverTime: now,
  };
}

/**
 * Event/Room Board projection, scoped server-side like a Show Board: each source Show is
 * projected with the SAME rules (Primary Queue, the Board's audience and components, its
 * Messages) through `toBoardSnapshot`; only the column label changes.
 * - `room`: every Show of the Room in display order (Room Agenda);
 * - `event`: per Room its current Show (label = Room name), plus Event Shows without Room.
 */
export function toEventBoardSnapshot(
  board: Board,
  agg: EventAggregate,
  shows: ReadonlyMap<string, ShowAggregate>,
  now: EpochMs,
): BoardStateSnapshot {
  const columns: { show: ShowAggregate; label: string }[] = [];
  if (board.sources.kind === 'room') {
    const roomId = board.sources.roomId;
    for (const p of showsIn(agg, roomId)) {
      const show = shows.get(p.showId);
      if (show) columns.push({ show, label: show.title });
    }
  } else {
    for (const room of agg.rooms) {
      if (room.status !== 'active') continue;
      const show = currentShowOfRoom(agg, room.id, shows);
      if (show) columns.push({ show, label: room.name });
    }
    for (const p of showsIn(agg, null)) {
      const show = shows.get(p.showId);
      if (show) columns.push({ show, label: show.title });
    }
  }

  const queues: BoardQueue[] = [];
  const messages = new Map<string, BoardStateSnapshot['messages'][number]>();
  for (const { show, label } of columns) {
    // The same Board (id, audience, components) read as a Primary-Queue Board of this Show.
    const projected = toBoardSnapshot(
      { ...board, showId: show.showId, eventId: null, sources: { kind: 'primary' } },
      show,
      now,
    );
    const queue = projected.queues[0];
    if (queue) {
      queues.push({ ...queue, name: label, discipline: label === show.title ? null : show.title });
    }
    for (const m of projected.messages) messages.set(m.id, m);
  }
  return {
    board: {
      id: board.id,
      name: board.name,
      preset: board.preset,
      audience: board.audience,
      components: board.components.map((c) => ({ ...c })),
      presentation: { ...board.presentation },
    },
    // Built from several aggregates: the server time is the monotonic version.
    version: now,
    timeZone: agg.event.timeZone,
    queues,
    messages: [...messages.values()].sort(compareMessages),
    serverTime: now,
  };
}
