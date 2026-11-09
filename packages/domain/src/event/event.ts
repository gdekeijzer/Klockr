import type { Board } from '../board';
import type { EventId, RoomId, ShowId } from '../ids';
import type { ActorRef } from '../lock';
import { err, ok, type Result } from '../result';
import type { EpochMs } from '../time';

/**
 * Optional physical/event context ABOVE Shows (M5). An Event is never a timer object: timers stay
 * on Queue Items, runtime state stays in Shows. A Show may be standalone, belong to an Event
 * without Room, or belong to exactly one Room of that Event.
 */
export type EventStatus = 'draft' | 'active' | 'completed' | 'archived';
export const EVENT_STATUSES: readonly EventStatus[] = ['draft', 'active', 'completed', 'archived'];

export type RoomStatus = 'active' | 'inactive';
export const ROOM_STATUSES: readonly RoomStatus[] = ['active', 'inactive'];

export interface Event {
  readonly id: EventId;
  readonly name: string;
  readonly description: string | null;
  readonly startsAt: EpochMs | null;
  readonly endsAt: EpochMs | null;
  /** One IANA timezone: the operational truth for Shows created inside the Event. */
  readonly timeZone: string;
  readonly status: EventStatus;
  readonly createdAt: EpochMs;
  readonly updatedAt: EpochMs;
  readonly revision: number;
}

/** "Room / Area" in the UI. Flat: no nested Rooms. */
export interface Room {
  readonly id: RoomId;
  readonly eventId: EventId;
  readonly name: string;
  readonly description: string | null;
  readonly position: number;
  readonly status: RoomStatus;
  readonly createdAt: EpochMs;
  readonly updatedAt: EpochMs;
  readonly revision: number;
}

/** Where a Show sits inside an Event. `roomId` null = Event Show without Room. */
export interface ShowPlacement {
  readonly showId: ShowId;
  readonly roomId: RoomId | null;
  /** Display order within its bucket (one Room, or the Event-without-Room bucket). */
  readonly position: number;
}

/** Structure/configuration lock on the Event or one Room. Never blocks live timer transport. */
export interface EventLock {
  readonly id: string;
  readonly target: EventLockTarget;
  readonly lockedAt: EpochMs;
  readonly lockedBy: ActorRef;
}
export interface EventLockTarget {
  readonly kind: 'event' | 'room';
  readonly id: string;
}

/** Consistency boundary for Event structure: one revision for compare-and-set. */
export interface EventAggregate {
  readonly event: Event;
  /** Ordered by position. */
  readonly rooms: readonly Room[];
  readonly shows: readonly ShowPlacement[];
  /** Event-owned Boards (Room Agenda, Central Agenda, Production overview). */
  readonly boards: readonly Board[];
  readonly locks: readonly EventLock[];
  readonly revision: number;
}

export type EventError =
  | { readonly code: 'invalid'; readonly reason: string }
  | { readonly code: 'not_found'; readonly reason: string };
export type EventResult = Result<EventAggregate, EventError>;

const invalid = (reason: string) => err<EventError>({ code: 'invalid', reason });
const notFound = (reason: string) => err<EventError>({ code: 'not_found', reason });

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function cleanText(value: string | null | undefined, max: number): string | null {
  const v = value?.trim() ?? '';
  return v.length === 0 ? null : v.slice(0, max);
}

export interface EventFields {
  readonly name: string;
  readonly description?: string | null | undefined;
  readonly startsAt?: EpochMs | null | undefined;
  readonly endsAt?: EpochMs | null | undefined;
  readonly timeZone: string;
  readonly status?: EventStatus | undefined;
}

export type EventPatch = { readonly [K in keyof EventFields]?: EventFields[K] | undefined };

function validateEvent(e: Event): Result<Event, EventError> {
  const name = e.name.trim();
  if (name.length === 0 || name.length > 120) return invalid('event name must be 1-120 characters');
  if (!isValidTimeZone(e.timeZone)) return invalid('unknown timezone');
  if (e.startsAt !== null && e.endsAt !== null && e.endsAt < e.startsAt) {
    return invalid('the event cannot end before it starts');
  }
  if (!EVENT_STATUSES.includes(e.status)) return invalid('unknown event status');
  return ok({ ...e, name });
}

export function createEvent(id: EventId, fields: EventFields, now: EpochMs): EventResult {
  const event = validateEvent({
    id,
    name: fields.name,
    description: cleanText(fields.description, 2000),
    startsAt: fields.startsAt ?? null,
    endsAt: fields.endsAt ?? null,
    timeZone: fields.timeZone,
    status: fields.status ?? 'draft',
    createdAt: now,
    updatedAt: now,
    revision: 0,
  });
  if (!event.ok) return event;
  return ok({ event: event.value, rooms: [], shows: [], boards: [], locks: [], revision: 0 });
}

/** +1 Event revision per accepted structural command. */
export function commitEvent(agg: EventAggregate, now: EpochMs): EventAggregate {
  return { ...agg, revision: agg.revision + 1, event: { ...agg.event, updatedAt: now } };
}

export function updateEvent(agg: EventAggregate, patch: EventPatch, now: EpochMs): EventResult {
  const next = validateEvent({
    ...agg.event,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.description !== undefined ? { description: cleanText(patch.description, 2000) } : {}),
    ...(patch.startsAt !== undefined ? { startsAt: patch.startsAt } : {}),
    ...(patch.endsAt !== undefined ? { endsAt: patch.endsAt } : {}),
    ...(patch.timeZone !== undefined ? { timeZone: patch.timeZone } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    updatedAt: now,
    revision: agg.event.revision + 1,
  });
  if (!next.ok) return next;
  return ok({ ...agg, event: next.value });
}

const renumberRooms = (rooms: readonly Room[]): Room[] =>
  rooms.map((r, position) => (r.position === position ? r : { ...r, position }));

export function addRoom(
  agg: EventAggregate,
  input: {
    readonly id: RoomId;
    readonly name: string;
    readonly description?: string | null | undefined;
  },
  now: EpochMs,
): EventResult {
  const name = input.name.trim();
  if (name.length === 0 || name.length > 80) return invalid('room name must be 1-80 characters');
  if (agg.rooms.length >= 50) return invalid('an Event has at most 50 Rooms');
  const room: Room = {
    id: input.id,
    eventId: agg.event.id,
    name,
    description: cleanText(input.description, 500),
    position: agg.rooms.length,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    revision: 0,
  };
  return ok({ ...agg, rooms: [...agg.rooms, room] });
}

export function updateRoom(
  agg: EventAggregate,
  roomId: string,
  patch: {
    readonly name?: string | undefined;
    readonly description?: string | null | undefined;
    readonly status?: RoomStatus | undefined;
  },
  now: EpochMs,
): EventResult {
  const room = agg.rooms.find((r) => r.id === roomId);
  if (!room) return notFound('room not found');
  const name = patch.name !== undefined ? patch.name.trim() : room.name;
  if (name.length === 0 || name.length > 80) return invalid('room name must be 1-80 characters');
  if (patch.status !== undefined && !ROOM_STATUSES.includes(patch.status)) {
    return invalid('unknown room status');
  }
  const next: Room = {
    ...room,
    name,
    description:
      patch.description !== undefined ? cleanText(patch.description, 500) : room.description,
    status: patch.status ?? room.status,
    updatedAt: now,
    revision: room.revision + 1,
  };
  return ok({ ...agg, rooms: agg.rooms.map((r) => (r.id === roomId ? next : r)) });
}

export function moveRoom(agg: EventAggregate, roomId: string, index: number): EventResult {
  const from = agg.rooms.findIndex((r) => r.id === roomId);
  if (from < 0) return notFound('room not found');
  if (!Number.isInteger(index) || index < 0 || index >= agg.rooms.length) {
    return invalid('room index out of range');
  }
  const rooms = [...agg.rooms];
  const [room] = rooms.splice(from, 1);
  if (!room) return notFound('room not found');
  rooms.splice(index, 0, room);
  return ok({ ...agg, rooms: renumberRooms(rooms) });
}

/** Only an empty Room can be deleted: Shows are never silently moved or detached. */
export function deleteRoom(agg: EventAggregate, roomId: string): EventResult {
  if (!agg.rooms.some((r) => r.id === roomId)) return notFound('room not found');
  if (agg.shows.some((s) => s.roomId === roomId)) {
    return invalid('the Room still has Shows; move or detach them first');
  }
  return ok({
    ...agg,
    rooms: renumberRooms(agg.rooms.filter((r) => r.id !== roomId)),
    boards: agg.boards.filter((b) => !(b.sources.kind === 'room' && b.sources.roomId === roomId)),
    locks: agg.locks.filter((l) => !(l.target.kind === 'room' && l.target.id === roomId)),
  });
}

/** Shows of one bucket (a Room, or `null` = Event without Room), in display order. */
export function showsIn(agg: EventAggregate, roomId: string | null): ShowPlacement[] {
  return agg.shows.filter((s) => s.roomId === roomId).sort((a, b) => a.position - b.position);
}

function withBucketOrder(
  shows: readonly ShowPlacement[],
  roomId: RoomId | null,
  ordered: readonly ShowPlacement[],
): ShowPlacement[] {
  const positions = new Map(ordered.map((s, position) => [s.showId, position]));
  return shows.map((s) =>
    s.roomId === roomId && positions.has(s.showId)
      ? { ...s, position: positions.get(s.showId) ?? s.position }
      : s,
  );
}

/**
 * Put a Show into this Event (a Room or no Room) or move it within the Event. Pure structure:
 * never touches the Show's runtime (Current, timers). A Show is in at most one Room.
 */
export function placeShow(
  agg: EventAggregate,
  input: { readonly showId: ShowId; readonly roomId: RoomId | null; readonly index?: number },
): EventResult {
  if (input.roomId !== null && !agg.rooms.some((r) => r.id === input.roomId)) {
    return notFound('room not found');
  }
  const existing = agg.shows.find((s) => s.showId === input.showId);
  const others = agg.shows.filter((s) => s.showId !== input.showId);
  const target = showsIn({ ...agg, shows: others }, input.roomId);
  const index = Math.max(0, Math.min(input.index ?? target.length, target.length));
  const placed: ShowPlacement = { showId: input.showId, roomId: input.roomId, position: index };
  const orderedTarget = [...target];
  orderedTarget.splice(index, 0, placed);
  let shows = withBucketOrder([...others, placed], input.roomId, orderedTarget);
  if (existing && existing.roomId !== input.roomId) {
    // Close the gap in the bucket the Show left.
    shows = withBucketOrder(shows, existing.roomId, showsIn({ ...agg, shows }, existing.roomId));
  }
  return ok({ ...agg, shows });
}

export function detachShow(agg: EventAggregate, showId: string): EventResult {
  const existing = agg.shows.find((s) => s.showId === showId);
  if (!existing) return notFound('show is not part of this event');
  const shows = agg.shows.filter((s) => s.showId !== showId);
  return ok({
    ...agg,
    shows: withBucketOrder(shows, existing.roomId, showsIn({ ...agg, shows }, existing.roomId)),
  });
}

// --- Event / Room locks ------------------------------------------------------------------

/**
 * Lock that guards a structural change touching `targets` (a Room change is guarded by the
 * Room's own lock and by the Event lock). Locks never apply to live transport inside a Show.
 */
export function eventLockFor(
  agg: EventAggregate,
  targets: readonly EventLockTarget[],
): EventLock | null {
  for (const t of [{ kind: 'event' as const, id: agg.event.id }, ...targets]) {
    const lock = agg.locks.find((l) => l.target.kind === t.kind && l.target.id === t.id);
    if (lock) return lock;
  }
  return null;
}

export function setEventLock(
  agg: EventAggregate,
  input: { readonly id: string; readonly target: EventLockTarget; readonly actor: ActorRef },
  now: EpochMs,
): EventResult {
  if (input.target.kind === 'event' && input.target.id !== agg.event.id) {
    return notFound('event not found');
  }
  if (input.target.kind === 'room' && !agg.rooms.some((r) => r.id === input.target.id)) {
    return notFound('room not found');
  }
  if (
    agg.locks.some((l) => l.target.kind === input.target.kind && l.target.id === input.target.id)
  ) {
    return ok(agg); // already locked: idempotent
  }
  return ok({
    ...agg,
    locks: [
      ...agg.locks,
      { id: input.id, target: input.target, lockedAt: now, lockedBy: input.actor },
    ],
  });
}

export function releaseEventLock(agg: EventAggregate, target: EventLockTarget): EventResult {
  if (!agg.locks.some((l) => l.target.kind === target.kind && l.target.id === target.id)) {
    return notFound('not locked');
  }
  return ok({
    ...agg,
    locks: agg.locks.filter((l) => !(l.target.kind === target.kind && l.target.id === target.id)),
  });
}
