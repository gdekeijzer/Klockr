import type {
  CreateEventRequest,
  EventCommandDto,
  EventStateSnapshot,
  ShowStateSnapshot,
} from '@klockr/contracts';
import {
  addRoom,
  BoardId,
  commitEvent,
  createEvent as createEventAggregate,
  createQuickTimerShow,
  deleteRoom,
  detachShow,
  duplicateShow as duplicateShowAggregate,
  EventId,
  eventLockFor,
  moveRoom,
  ok,
  placeShow,
  presetDefaults,
  QueueId,
  QueueItemId,
  releaseEventLock,
  RoomId,
  setEventLock,
  ShowId,
  showEffectiveLock,
  updateEvent,
  updateRoom,
  validateBoard,
  type Board,
  type EventAggregate,
  type EventError,
  type EventLockTarget,
  type Permission,
  type Show,
  type ShowAggregate,
} from '@klockr/domain';
import type { CommandContext } from '../command';
import { appError, type AppError, type CommandResult } from '../errors';
import { stableStringify } from '../idempotency';
import type { AuditRecord, DevicePresence, DeviceRepository, EventRepository } from '../ports';
import { actorRef, type AuditDraft } from '../queue/mutate';
import { sourcesFromDto, type ShowContextDto } from '../queue/projection';
import { getShowState, newGrant, type ShowServiceDeps } from '../show/quick-timer';
import { toEventStateSnapshot } from './projection';

/** Use-case dependencies including the M5 repositories. */
export interface PlatformDeps extends ShowServiceDeps {
  readonly eventStore: EventRepository;
  readonly deviceStore: DeviceRepository;
  readonly presence: DevicePresence;
}

const fromEventError = (e: EventError): CommandResult<never> =>
  appError(e.code === 'not_found' ? 'not_found' : 'validation_failed', e.reason);

/** Event + every Show placed in it (for projections). */
export async function loadEventView(
  eventId: string,
  deps: PlatformDeps,
): Promise<{ agg: EventAggregate; shows: Map<string, ShowAggregate> } | null> {
  const agg = await deps.eventStore.loadEvent(EventId(eventId));
  if (!agg) return null;
  const loaded = await Promise.all(
    agg.shows.map((p) => deps.state.loadShowAggregate(ShowId(p.showId))),
  );
  const shows = new Map<string, ShowAggregate>();
  for (const s of loaded) if (s) shows.set(s.showId, s);
  return { agg, shows };
}

export async function buildEventState(
  eventId: string,
  deps: PlatformDeps,
): Promise<EventStateSnapshot | null> {
  const view = await loadEventView(eventId, deps);
  if (!view) return null;
  const devices = await deps.deviceStore.listDevices({ showId: null, eventId: view.agg.event.id });
  return toEventStateSnapshot(view.agg, view.shows, devices, deps.presence, deps.clock.now());
}

/** M5 breadcrumb of a Show (Event / Room), or null when standalone. */
export async function showContextOf(
  meta: Show,
  deps: Pick<PlatformDeps, 'eventStore'>,
): Promise<ShowContextDto> {
  if (!meta.eventId) return null;
  const agg = await deps.eventStore.loadEvent(meta.eventId);
  if (!agg) return null;
  const room = meta.roomId ? agg.rooms.find((r) => r.id === meta.roomId) : undefined;
  return {
    eventId: agg.event.id,
    eventName: agg.event.name,
    roomId: room?.id ?? null,
    roomName: room?.name ?? null,
  };
}

/** Show management projection including its M5 Event / Room breadcrumb. */
export async function getShowStateWithContext(
  showId: ShowId,
  context: CommandContext,
  deps: PlatformDeps,
): Promise<CommandResult<ShowStateSnapshot>> {
  const state = await getShowState(showId, context, deps);
  if (!state.ok) return state;
  const meta = await deps.shows.getShow(showId);
  const ctx = meta ? await showContextOf(meta, deps) : null;
  return ok({ ...state.value, show: { ...state.value.show, context: ctx } });
}

/**
 * Anonymous Event creation (no account): the creating browser receives the Event owner
 * credential. Nothing about Quick Timers changes; Events are optional.
 */
export async function createEvent(
  input: CreateEventRequest,
  deps: PlatformDeps,
): Promise<CommandResult<{ eventId: EventId; ownerToken: string }>> {
  const now = deps.clock.now();
  const eventId = EventId(deps.ids.uuid());
  const agg = createEventAggregate(
    eventId,
    {
      name: input.name,
      description: input.description ?? null,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      timeZone: input.timeZone,
    },
    now,
  );
  if (!agg.ok) return fromEventError(agg.error);
  const owner = newGrant(deps, 'anonymous_event_owner', { showId: null, eventId }, null);
  await deps.eventStore.createEvent(agg.value, [owner.record]);
  return ok({ eventId, ownerToken: owner.token });
}

export async function getEventState(
  eventId: string,
  context: CommandContext,
  deps: PlatformDeps,
): Promise<CommandResult<EventStateSnapshot>> {
  if (!(await deps.authorizer.can(context.actor, 'event.read', { kind: 'event', id: eventId }))) {
    return appError('forbidden', 'Not permitted to read this Event');
  }
  const state = await buildEventState(eventId, deps);
  return state ? ok(state) : appError('not_found', 'Event not found');
}

// --- The single Event mutation path ----------------------------------------------------------

interface EventMutationResult<T> {
  readonly event: EventAggregate;
  readonly value: T;
  readonly audit?: readonly AuditDraft[];
  /** Shows whose placement changed. */
  readonly showIds?: readonly string[];
}

interface EventMutationSpec<T> {
  readonly commandId: string;
  readonly commandType: string;
  readonly intent: unknown;
  readonly idempotencyKey?: string | undefined;
  readonly expectedRevision?: number | undefined;
  readonly permission: Permission;
  /** Event/Room locks guarding this change; null = never gated (lock management itself). */
  readonly lockTargets: ((agg: EventAggregate) => readonly EventLockTarget[]) | null;
  /** Shows whose own Show-level lock guards this change (structural move of a Show). */
  readonly lockedShows?: ((agg: EventAggregate) => readonly string[]) | undefined;
  readonly override?: { readonly reason: string } | undefined;
  readonly apply: (agg: EventAggregate, now: number) => CommandResult<EventMutationResult<T>>;
}

/**
 * Capability -> idempotent replay -> load -> expected revision -> Event/Room lock gate and
 * Show lock gate (or audited Emergency Override) -> pure operation -> ONE compare-and-set save
 * of the Event (placement on the Shows in the same transaction) incl. audit -> publish. Event
 * and Room locks guard structure/configuration only, never live timer transport in a Show.
 */
async function mutateEvent<T>(
  eventId: string,
  spec: EventMutationSpec<T>,
  context: CommandContext,
  deps: PlatformDeps,
): Promise<CommandResult<{ event: EventAggregate; value: T }>> {
  const resource = { kind: 'event' as const, id: eventId };
  if (!(await deps.authorizer.can(context.actor, spec.permission, resource))) {
    return appError('forbidden', 'Not permitted to perform this action on this Event');
  }
  const mayOverride =
    spec.override !== undefined &&
    (await deps.authorizer.can(context.actor, 'lock.override', resource));
  const scope = `${context.actor.kind}:${context.actor.id}`;
  const fingerprint = stableStringify({ eventId, type: spec.commandType, intent: spec.intent });
  if (spec.idempotencyKey !== undefined) {
    const stored = await deps.idempotency.find(scope, spec.idempotencyKey);
    if (stored) {
      if (stored.fingerprint !== fingerprint) {
        return appError('idempotency_conflict', 'Idempotency key was used for a different command');
      }
      return stored.result as CommandResult<{ event: EventAggregate; value: T }>;
    }
  }
  const actor = actorRef(context.actor);
  for (let attempt = 1; ; attempt++) {
    const prev = await deps.eventStore.loadEvent(EventId(eventId));
    if (!prev) return appError('not_found', 'Event not found');
    if (spec.expectedRevision !== undefined && spec.expectedRevision !== prev.revision) {
      return appError('revision_conflict', 'Event has changed since it was read', {
        expectedRevision: spec.expectedRevision,
        actualRevision: prev.revision,
      });
    }
    const now = deps.clock.now();
    let lock: { target: { kind: string; id: string }; id: string } | null = spec.lockTargets
      ? eventLockFor(prev, spec.lockTargets(prev))
      : null;
    if (!lock && spec.lockedShows) {
      for (const showId of spec.lockedShows(prev)) {
        const show = await deps.state.loadShowAggregate(ShowId(showId));
        const showLock = show ? showEffectiveLock(show, { kind: 'show', id: showId }) : null;
        if (showLock) {
          lock = { id: showLock.lock.id, target: showLock.lock.target };
          break;
        }
      }
    }
    if (lock && !spec.override) {
      return appError('locked', `Locked by a lock on this ${lock.target.kind}`, {
        lock: { id: lock.id, target: lock.target },
      });
    }
    if (lock && !mayOverride) {
      return appError('forbidden', 'Emergency Override requires the lock.override permission');
    }
    const outcome = spec.apply(prev, now);
    if (!outcome.ok) return outcome;
    const next = commitEvent(outcome.value.event, now);
    const audit: AuditRecord[] = (outcome.value.audit ?? []).map((record) => ({
      ...record,
      id: deps.ids.uuid(),
      showId: null,
      eventId: EventId(eventId),
      actor,
      at: now,
    }));
    if (lock && spec.override) {
      audit.unshift({
        id: deps.ids.uuid(),
        showId: null,
        eventId: EventId(eventId),
        actor,
        at: now,
        action: 'lock.override',
        resource: lock.target,
        details: { reason: spec.override.reason, command: spec.commandType, lockId: lock.id },
      });
    }
    const saved = await deps.eventStore.saveEvent(prev, next, audit);
    if (!saved.ok) {
      if (
        saved.error.code === 'revision_conflict' &&
        spec.expectedRevision === undefined &&
        attempt < 3
      ) {
        continue;
      }
      return saved;
    }
    const result = ok({ event: next, value: outcome.value.value });
    if (spec.idempotencyKey !== undefined) {
      await deps.idempotency.remember(scope, spec.idempotencyKey, { fingerprint, result });
    }
    try {
      await deps.events.publish({
        type: 'event.changed',
        eventId: EventId(eventId),
        showIds: (outcome.value.showIds ?? []).map(ShowId),
        occurredAt: now,
      });
    } catch (error) {
      deps.onPublishError?.(error);
    }
    return result;
  }
}

function permissionOf(type: EventCommandDto['type']): Permission {
  switch (type) {
    case 'event.update':
      return 'event.manage';
    case 'room.create':
    case 'room.update':
    case 'room.move':
    case 'room.delete':
      return 'room.manage';
    case 'show.place':
    case 'show.detach':
      return 'show.move';
    case 'board.create':
    case 'board.update':
    case 'board.delete':
      return 'board.manage';
    case 'lock.set':
    case 'lock.release':
      return 'lock.manage';
  }
}

const roomTarget = (id: string | null | undefined): EventLockTarget[] =>
  id ? [{ kind: 'room', id }] : [];

/** Event structure commands (Event Dashboard). */
export async function executeEventCommand(
  eventId: string,
  command: EventCommandDto,
  context: CommandContext,
  deps: PlatformDeps,
): Promise<CommandResult<{ state: EventStateSnapshot; createdId: string | null }>> {
  const created: { id: string | null } = { id: null };
  const done = (
    event: EventAggregate,
    audit: AuditDraft[] = [],
    showIds: string[] = [],
  ): CommandResult<EventMutationResult<string | null>> =>
    ok({ event, value: created.id, audit, showIds });
  const lift = (
    r: ReturnType<typeof addRoom>,
    audit: AuditDraft[] = [],
    showIds: string[] = [],
  ): CommandResult<EventMutationResult<string | null>> =>
    r.ok ? done(r.value, audit, showIds) : fromEventError(r.error);

  const placementOf = (agg: EventAggregate, showId: string) =>
    agg.shows.find((s) => s.showId === showId);

  let lockTargets: EventMutationSpec<string | null>['lockTargets'] = () => [];
  let lockedShows: EventMutationSpec<string | null>['lockedShows'];
  let apply: EventMutationSpec<string | null>['apply'];

  switch (command.type) {
    case 'event.update':
      apply = (agg, now) =>
        lift(updateEvent(agg, command.payload, now), [
          {
            action: 'event.update',
            resource: { kind: 'event', id: eventId },
            details: { ...command.payload },
          },
        ]);
      break;
    case 'room.create':
      apply = (agg, now) => {
        const id = RoomId(deps.ids.uuid());
        created.id = id;
        return lift(addRoom(agg, { id, ...command.payload }, now), [
          {
            action: 'room.create',
            resource: { kind: 'room', id },
            details: { name: command.payload.name },
          },
        ]);
      };
      break;
    case 'room.update': {
      const { roomId, ...patch } = command.payload;
      lockTargets = () => roomTarget(roomId);
      apply = (agg, now) =>
        lift(updateRoom(agg, roomId, patch, now), [
          { action: 'room.update', resource: { kind: 'room', id: roomId }, details: { ...patch } },
        ]);
      break;
    }
    case 'room.move':
      lockTargets = () => roomTarget(command.payload.roomId);
      apply = (agg) =>
        lift(moveRoom(agg, command.payload.roomId, command.payload.index), [
          {
            action: 'room.move',
            resource: { kind: 'room', id: command.payload.roomId },
            details: { index: command.payload.index },
          },
        ]);
      break;
    case 'room.delete':
      lockTargets = () => roomTarget(command.payload.roomId);
      apply = (agg) =>
        lift(deleteRoom(agg, command.payload.roomId), [
          {
            action: 'room.delete',
            resource: { kind: 'room', id: command.payload.roomId },
            details: { name: agg.rooms.find((r) => r.id === command.payload.roomId)?.name ?? null },
          },
        ]);
      break;
    case 'show.place': {
      const { showId, roomId, index } = command.payload;
      lockTargets = (agg) => [
        ...roomTarget(placementOf(agg, showId)?.roomId),
        ...roomTarget(roomId),
      ];
      lockedShows = () => [showId];
      apply = (agg) => {
        const from = placementOf(agg, showId);
        if (!from) return appError('not_found', 'Show is not part of this Event');
        return lift(
          placeShow(agg, {
            showId: ShowId(showId),
            roomId: roomId === null ? null : RoomId(roomId),
            ...(index !== undefined ? { index } : {}),
          }),
          [
            {
              action: 'show.move',
              resource: { kind: 'show', id: showId },
              details: { fromRoomId: from.roomId, toRoomId: roomId, index: index ?? null },
            },
          ],
          [showId],
        );
      };
      break;
    }
    case 'show.detach': {
      const { showId } = command.payload;
      lockTargets = (agg) => roomTarget(placementOf(agg, showId)?.roomId);
      lockedShows = () => [showId];
      apply = (agg) =>
        lift(
          detachShow(agg, showId),
          [
            {
              action: 'show.detach',
              resource: { kind: 'show', id: showId },
              details: { fromRoomId: placementOf(agg, showId)?.roomId ?? null },
            },
          ],
          [showId],
        );
      break;
    }
    case 'board.create':
      apply = (agg, now) => {
        const { preset, name, roomId } = command.payload;
        if (roomId && !agg.rooms.some((r) => r.id === roomId)) {
          return appError('not_found', 'room not found');
        }
        if (agg.boards.length >= 50) return appError('validation_failed', 'too many boards');
        const defaults = presetDefaults(preset);
        const id = BoardId(deps.ids.uuid());
        created.id = id;
        const board: Board = {
          id,
          showId: null,
          eventId: agg.event.id,
          name: name ?? defaults.name,
          preset,
          audience: defaults.audience,
          sources: roomId ? { kind: 'room', roomId: RoomId(roomId) } : { kind: 'event' },
          components: defaults.components,
          presentation: defaults.presentation,
          createdAt: now,
          updatedAt: now,
          revision: 0,
        };
        const valid = validateBoard(
          board,
          [],
          agg.rooms.map((r) => r.id),
        );
        if (!valid.ok) return appError('validation_failed', valid.error);
        return done({ ...agg, boards: [...agg.boards, valid.value] }, [
          {
            action: 'board.create',
            resource: { kind: 'board', id },
            details: { preset, roomId: roomId ?? null },
          },
        ]);
      };
      break;
    case 'board.update':
      apply = (agg, now) => {
        const { boardId, sources, presentation, ...rest } = command.payload;
        const existing = agg.boards.find((b) => b.id === boardId);
        if (!existing) return appError('not_found', 'board not found');
        const candidate: Board = {
          ...existing,
          ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
          ...(sources ? { sources: sourcesFromDto(sources) } : {}),
          presentation: {
            lowLight: presentation?.lowLight ?? existing.presentation.lowLight,
            showTimes: presentation?.showTimes ?? existing.presentation.showTimes,
          },
          updatedAt: now,
          revision: existing.revision + 1,
        };
        const valid = validateBoard(
          candidate,
          [],
          agg.rooms.map((r) => r.id),
        );
        if (!valid.ok) return appError('validation_failed', valid.error);
        return done({
          ...agg,
          boards: agg.boards.map((b) => (b.id === boardId ? valid.value : b)),
        });
      };
      break;
    case 'board.delete':
      apply = (agg) => {
        if (!agg.boards.some((b) => b.id === command.payload.boardId)) {
          return appError('not_found', 'board not found');
        }
        return done(
          { ...agg, boards: agg.boards.filter((b) => b.id !== command.payload.boardId) },
          [
            {
              action: 'board.delete',
              resource: { kind: 'board', id: command.payload.boardId },
              details: {},
            },
          ],
        );
      };
      break;
    case 'lock.set':
      lockTargets = null;
      apply = (agg, now) =>
        lift(
          setEventLock(
            agg,
            { id: deps.ids.uuid(), target: command.payload.target, actor: actorRef(context.actor) },
            now,
          ),
          [{ action: 'lock.set', resource: command.payload.target, details: {} }],
        );
      break;
    case 'lock.release':
      lockTargets = null;
      apply = (agg) =>
        lift(releaseEventLock(agg, command.payload.target), [
          { action: 'lock.release', resource: command.payload.target, details: {} },
        ]);
      break;
  }

  const result = await mutateEvent<string | null>(
    eventId,
    {
      commandId: command.commandId,
      commandType: command.type,
      intent: command.payload,
      idempotencyKey: command.idempotencyKey,
      expectedRevision: command.expectedRevision,
      permission: permissionOf(command.type),
      lockTargets,
      lockedShows,
      override: command.override,
      apply,
    },
    context,
    deps,
  );
  if (!result.ok) return result;
  const state = await buildEventState(eventId, deps);
  if (!state) return appError('not_found', 'Event not found');
  return ok({ state, createdId: result.value.value });
}

// --- Shows inside Events -----------------------------------------------------------------------

export interface CreatedShow {
  readonly showId: ShowId;
  /** Owner credential of the new Show (cookie); it stays manageable when detached later. */
  readonly ownerToken: string;
}

/** Place a Show (already authorized for the Show) into an Event via the Event mutation path. */
async function placeIntoEvent(
  eventId: string,
  showId: ShowId,
  roomId: string | null,
  action: 'show.create' | 'show.attach' | 'show.duplicate',
  details: Record<string, unknown>,
  context: CommandContext,
  deps: PlatformDeps,
): Promise<CommandResult<{ event: EventAggregate; value: null }>> {
  return mutateEvent<null>(
    eventId,
    {
      commandId: deps.ids.uuid(),
      commandType: action,
      intent: { showId, roomId },
      permission: 'show.move',
      lockTargets: () => roomTarget(roomId),
      apply: (agg) => {
        if (agg.shows.some((s) => s.showId === showId)) {
          return appError('validation_failed', 'Show is already part of this Event');
        }
        const placed = placeShow(agg, {
          showId,
          roomId: roomId === null ? null : RoomId(roomId),
        });
        return placed.ok
          ? ok({
              event: placed.value,
              value: null,
              audit: [
                { action, resource: { kind: 'show', id: showId }, details: { roomId, ...details } },
              ],
              showIds: [showId],
            })
          : fromEventError(placed.error);
      },
    },
    context,
    deps,
  );
}

/** A new Show inside an Event (optionally a Room). It inherits the Event timezone. */
export async function createShowInEvent(
  eventId: string,
  input: {
    readonly title: string;
    readonly roomId?: string | null | undefined;
    readonly durationMs?: number | undefined;
  },
  context: CommandContext,
  deps: PlatformDeps,
): Promise<CommandResult<CreatedShow>> {
  if (!(await deps.authorizer.can(context.actor, 'show.create', { kind: 'event', id: eventId }))) {
    return appError('forbidden', 'Not permitted to create Shows in this Event');
  }
  const agg = await deps.eventStore.loadEvent(EventId(eventId));
  if (!agg) return appError('not_found', 'Event not found');
  const roomId = input.roomId ?? null;
  if (roomId && !agg.rooms.some((r) => r.id === roomId))
    return appError('not_found', 'room not found');
  const now = deps.clock.now();
  const ids = {
    showId: ShowId(deps.ids.uuid()),
    queueId: QueueId(deps.ids.uuid()),
    queueItemId: QueueItemId(deps.ids.uuid()),
    boardId: BoardId(deps.ids.uuid()),
  };
  const scheduleDate =
    agg.event.startsAt === null
      ? null
      : new Intl.DateTimeFormat('en-CA', { timeZone: agg.event.timeZone }).format(
          agg.event.startsAt,
        );
  const bundle = createQuickTimerShow(ids, input.durationMs ?? 10 * 60_000, now, {
    timeZone: agg.event.timeZone,
    scheduleDate,
  });
  if (!bundle.ok) return appError('validation_failed', 'invalid duration');
  const { show, queue, item, board } = bundle.value;
  const meta: Show = { ...show, title: input.title.trim() };
  const aggregate: ShowAggregate = {
    showId: show.id,
    title: meta.title,
    revision: 0,
    primaryQueueId: show.primaryQueueId,
    showWarning: show.warning,
    showSchedule: show.schedule,
    queues: [{ queue, groups: [], items: [item] }],
    locks: [],
    unlockRequests: [],
    relations: [],
    suggestions: [],
    boards: [board],
    messages: [],
  };
  const owner = newGrant(deps, 'anonymous_owner', show.id, null);
  await deps.shows.createShow(meta, aggregate, [owner.record]);
  const placed = await placeIntoEvent(
    eventId,
    show.id,
    roomId,
    'show.create',
    { title: meta.title },
    context,
    deps,
  );
  if (!placed.ok) return placed;
  return ok({ showId: show.id, ownerToken: owner.token });
}

/**
 * Attach an existing standalone Show to an Event. Needs BOTH: `show.move` on the Show (its
 * owner) and `show.move` on the Event (its owner). A Show in another Event must be detached
 * there first; the Show keeps its own timezone (never silently rewritten).
 */
export async function attachShowToEvent(
  eventId: string,
  input: { readonly showId: string; readonly roomId?: string | null | undefined },
  contexts: { readonly event: CommandContext; readonly show: CommandContext },
  deps: PlatformDeps,
): Promise<CommandResult<null>> {
  const showId = ShowId(input.showId);
  if (
    !(await deps.authorizer.can(contexts.show.actor, 'show.move', { kind: 'show', id: showId }))
  ) {
    return appError('forbidden', 'Owner access to this Show is required to add it to an Event');
  }
  const meta = await deps.shows.getShow(showId);
  if (!meta) return appError('not_found', 'Show not found');
  if (meta.eventId && meta.eventId !== eventId) {
    return appError(
      'validation_failed',
      'The Show belongs to another Event; detach it there first',
    );
  }
  const placed = await placeIntoEvent(
    eventId,
    showId,
    input.roomId ?? null,
    'show.attach',
    { title: meta.title },
    contexts.event,
    deps,
  );
  return placed.ok ? ok(null) : placed;
}

/**
 * Explicit Show duplication: a clean/idle copy (see `duplicateShow` in the domain). A Show inside
 * an Event is copied into the same Event (the chosen Room, default: no Room) when the actor may
 * place Shows there; otherwise the copy is standalone.
 */
export async function duplicateShow(
  sourceShowId: string,
  input: { readonly title?: string | undefined; readonly roomId?: string | null | undefined },
  context: CommandContext,
  deps: PlatformDeps,
  /** Credential used to place the copy in the source's Event (default: `context`). */
  placementContext: CommandContext = context,
): Promise<CommandResult<CreatedShow>> {
  const sourceId = ShowId(sourceShowId);
  if (
    !(await deps.authorizer.can(context.actor, 'show.duplicate', { kind: 'show', id: sourceId }))
  ) {
    return appError('forbidden', 'Not permitted to duplicate this Show');
  }
  const [meta, source] = await Promise.all([
    deps.shows.getShow(sourceId),
    deps.state.loadShowAggregate(sourceId),
  ]);
  if (!meta || !source) return appError('not_found', 'Show not found');
  const now = deps.clock.now();
  const showId = ShowId(deps.ids.uuid());
  const title = (input.title ?? `${meta.title} (copy)`).trim().slice(0, 120);
  const copy = duplicateShowAggregate(source, { showId, title, newId: () => deps.ids.uuid(), now });
  const copyMeta: Show = {
    ...meta,
    id: showId,
    title,
    primaryQueueId: copy.primaryQueueId,
    createdAt: now,
    lastActiveAt: now,
    expiresAt: now + (meta.expiresAt - meta.createdAt),
    eventId: null,
    roomId: null,
  };
  const owner = newGrant(deps, 'anonymous_owner', showId, null);
  const audit: AuditRecord[] = [
    {
      id: deps.ids.uuid(),
      showId: sourceId,
      eventId: meta.eventId,
      at: now,
      actor: actorRef(context.actor),
      action: 'show.duplicate',
      resource: { kind: 'show', id: sourceId },
      details: { copyShowId: showId, title },
    },
  ];
  await deps.shows.createShow(copyMeta, copy, [owner.record], audit);
  if (
    meta.eventId &&
    (await deps.authorizer.can(placementContext.actor, 'show.move', {
      kind: 'event',
      id: meta.eventId,
    }))
  ) {
    const placed = await placeIntoEvent(
      meta.eventId,
      showId,
      input.roomId ?? null,
      'show.duplicate',
      { sourceShowId: sourceId, title },
      placementContext,
      deps,
    );
    if (!placed.ok) return placed;
  }
  return ok({ showId, ownerToken: owner.token });
}

export type { AppError };
