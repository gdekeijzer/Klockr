import { z } from 'zod';
import {
  boardComponentSchema,
  boardConfigSchema,
  boardPresentationSchema,
  boardPresetSchema,
  boardSourcesSchema,
  boardStateSnapshotSchema,
} from './board';
import { commandSchema, epochMsSchema, idSchema, revisionSchema } from './common';
import { audienceSchema } from './queue';
import { MAX_DURATION_MS, timerSnapshotSchema } from './timer';

/**
 * M5: Events, Rooms (UI "Room / Area"), Show placement, Show duplication, Devices and Board
 * share management. Events and Rooms are optional context above Shows; a standalone Show and
 * the Quick Timer flow are unchanged.
 */

export const eventStatusSchema = z.enum(['draft', 'active', 'completed', 'archived']);
export const roomStatusSchema = z.enum(['active', 'inactive']);
const timeZoneSchema = z.string().min(1).max(64);
const nameSchema = z.string().trim().min(1).max(120);
const descriptionSchema = z.string().max(2000).nullable();

// --- Event creation / Show creation and placement ----------------------------------------

/** POST /api/v1/events — the creating browser receives the Event owner credential (cookie). */
export const createEventRequestSchema = z.object({
  name: nameSchema,
  description: descriptionSchema.optional(),
  startsAt: epochMsSchema.nullable().optional(),
  endsAt: epochMsSchema.nullable().optional(),
  timeZone: timeZoneSchema,
});
export type CreateEventRequest = z.infer<typeof createEventRequestSchema>;
export const createEventResponseSchema = z.object({ eventId: idSchema });

/** POST /api/v1/events/:eventId/shows — a new Show inside the Event (inherits its timezone). */
export const createEventShowRequestSchema = z.object({
  title: nameSchema,
  roomId: idSchema.nullable().optional(),
  durationMs: z.int().positive().max(MAX_DURATION_MS).optional(),
});
/** POST /api/v1/events/:eventId/shows/attach — needs owner access to BOTH Event and Show. */
export const attachShowRequestSchema = z.object({
  showId: idSchema,
  roomId: idSchema.nullable().optional(),
});
/** POST /api/v1/shows/:showId/duplicate — clean/idle copy (same Event, chosen Room). */
export const duplicateShowRequestSchema = z.object({
  title: nameSchema.optional(),
  roomId: idSchema.nullable().optional(),
});
export const createdShowResponseSchema = z.object({ showId: idSchema });
export type CreatedShowResponse = z.infer<typeof createdShowResponseSchema>;

// --- Event commands (POST /api/v1/events/:eventId/commands) ------------------------------

const lockTargetSchema = z.object({ kind: z.enum(['event', 'room']), id: idSchema });

export const eventCommandSchema = z.discriminatedUnion('type', [
  commandSchema(
    'event.update',
    z.object({
      name: nameSchema.optional(),
      description: descriptionSchema.optional(),
      startsAt: epochMsSchema.nullable().optional(),
      endsAt: epochMsSchema.nullable().optional(),
      timeZone: timeZoneSchema.optional(),
      status: eventStatusSchema.optional(),
    }),
  ),
  commandSchema(
    'room.create',
    z.object({ name: z.string().trim().min(1).max(80), description: descriptionSchema.optional() }),
  ),
  commandSchema(
    'room.update',
    z.object({
      roomId: idSchema,
      name: z.string().trim().min(1).max(80).optional(),
      description: descriptionSchema.optional(),
      status: roomStatusSchema.optional(),
    }),
  ),
  commandSchema('room.move', z.object({ roomId: idSchema, index: z.int().min(0).max(49) })),
  commandSchema('room.delete', z.object({ roomId: idSchema })),
  /** Move a Show within the Event: into a Room, between Rooms, or out of a Room. Structure only. */
  commandSchema(
    'show.place',
    z.object({
      showId: idSchema,
      roomId: idSchema.nullable(),
      index: z.int().min(0).max(500).optional(),
    }),
  ),
  commandSchema('show.detach', z.object({ showId: idSchema })),
  commandSchema(
    'board.create',
    z.object({
      preset: boardPresetSchema,
      name: z.string().trim().min(1).max(100).optional(),
      /** Room Agenda of one Room; omitted/null = Event-wide (Central Agenda). */
      roomId: idSchema.nullable().optional(),
    }),
  ),
  commandSchema(
    'board.update',
    z.object({
      boardId: idSchema,
      name: z.string().trim().min(1).max(100).optional(),
      audience: audienceSchema.optional(),
      sources: boardSourcesSchema.optional(),
      components: z.array(boardComponentSchema).max(20).optional(),
      presentation: boardPresentationSchema.partial().optional(),
    }),
  ),
  commandSchema('board.delete', z.object({ boardId: idSchema })),
  commandSchema('lock.set', z.object({ target: lockTargetSchema })),
  commandSchema('lock.release', z.object({ target: lockTargetSchema })),
]);
export type EventCommandDto = z.infer<typeof eventCommandSchema>;

// --- Event state (management projection; Event Dashboard and Room View) ------------------

export const eventAgendaItemSchema = z.object({
  id: idSchema,
  title: z.string(),
  plannedStart: epochMsSchema.nullable(),
  projectedStart: epochMsSchema.nullable(),
  durationMs: z.int().nullable(),
  state: z.enum(['completed', 'current', 'upcoming', 'skipped']),
  fixedAnchor: z.boolean(),
});

export const eventShowSummarySchema = z.object({
  id: idSchema,
  title: z.string(),
  roomId: idSchema.nullable(),
  position: z.int(),
  timeZone: z.string(),
  revision: revisionSchema,
  primaryQueueName: z.string(),
  current: z
    .object({ id: idSchema, title: z.string(), subtitle: z.string().nullable() })
    .nullable(),
  currentTimer: timerSnapshotSchema.nullable(),
  next: z
    .object({
      title: z.string(),
      plannedStart: epochMsSchema.nullable(),
      projectedStart: epochMsSchema.nullable(),
    })
    .nullable(),
  /** Show offset of the Primary Queue (negative = ahead). */
  offsetMs: z.int().nullable(),
  toleranceMs: z.int(),
  severeBehindMs: z.int(),
  anchor: z
    .object({
      title: z.string(),
      plannedStart: epochMsSchema,
      recoveryMs: z.int(),
      recoverableMs: z.int(),
    })
    .nullable(),
  /** Running or paused timers across all Queues of the Show. */
  runningTimers: z.int(),
  conflicts: z.int(),
  pendingSuggestions: z.int(),
  locked: z.boolean(),
  boards: z.array(z.object({ id: idSchema, name: z.string(), preset: boardPresetSchema })),
  /** Primary Queue rundown (Room agenda view over Show data; no agenda database). */
  agenda: z.array(eventAgendaItemSchema),
});
export type EventShowSummary = z.infer<typeof eventShowSummarySchema>;

export const deviceStatusSchema = z.enum([
  'online',
  'recently_seen',
  'offline',
  'never_connected',
  'revoked',
]);
export const deviceSnapshotSchema = z.object({
  id: idSchema,
  name: z.string(),
  status: deviceStatusSchema,
  assignedBoardId: idSchema.nullable(),
  assignedBoardName: z.string().nullable(),
  createdAt: epochMsSchema,
  lastSeenAt: epochMsSchema.nullable(),
  revokedAt: epochMsSchema.nullable(),
  revision: revisionSchema,
});
export type DeviceSnapshot = z.infer<typeof deviceSnapshotSchema>;

export const eventStateSnapshotSchema = z.object({
  event: z.object({
    id: idSchema,
    name: z.string(),
    description: z.string().nullable(),
    startsAt: epochMsSchema.nullable(),
    endsAt: epochMsSchema.nullable(),
    timeZone: z.string(),
    status: eventStatusSchema,
    revision: revisionSchema,
  }),
  rooms: z.array(
    z.object({
      id: idSchema,
      name: z.string(),
      description: z.string().nullable(),
      position: z.int(),
      status: roomStatusSchema,
      locked: z.boolean(),
    }),
  ),
  shows: z.array(eventShowSummarySchema),
  boards: z.array(boardConfigSchema),
  locks: z.array(z.object({ id: idSchema, target: lockTargetSchema, lockedAt: epochMsSchema })),
  devices: z.array(deviceSnapshotSchema),
  /** Event aggregate revision (structure); Show runtime changes arrive as new snapshots too. */
  revision: revisionSchema,
  serverTime: epochMsSchema,
});
export type EventStateSnapshot = z.infer<typeof eventStateSnapshotSchema>;

export const eventCommandResponseSchema = z.object({
  state: eventStateSnapshotSchema,
  createdId: z.string().nullable(),
});
export type EventCommandResponse = z.infer<typeof eventCommandResponseSchema>;

// --- Devices --------------------------------------------------------------------------------

/** POST /api/v1/devices/pairing — the display asks for a short pairing code. */
export const pairingStartResponseSchema = z.object({
  /** Display form, e.g. "7K4M-P2". */
  code: z.string(),
  /** High-entropy secret kept by the display to claim its credential (not the code). */
  pairingSecret: z.string(),
  expiresAt: epochMsSchema,
});
export type PairingStartResponse = z.infer<typeof pairingStartResponseSchema>;

/** POST /api/v1/devices/pairing/claim — 202 pending, 200 credential (once), 410 expired/used. */
export const pairingClaimRequestSchema = z.object({ pairingSecret: z.string().min(1).max(200) });
export const pairingClaimResponseSchema = z.union([
  z.object({ status: z.literal('pending') }),
  z.object({ status: z.literal('paired'), deviceId: idSchema, deviceToken: z.string() }),
]);
export type PairingClaimResponse = z.infer<typeof pairingClaimResponseSchema>;

/** Device management commands (POST /api/v1/{shows|events}/:id/devices). */
export const deviceCommandSchema = z.discriminatedUnion('type', [
  commandSchema(
    'device.pair',
    z.object({
      code: z.string().min(4).max(16),
      name: z.string().trim().min(1).max(80),
      boardId: idSchema.nullable().optional(),
    }),
  ),
  commandSchema(
    'device.rename',
    z.object({ deviceId: idSchema, name: z.string().trim().min(1).max(80) }),
  ),
  commandSchema('device.assign', z.object({ deviceId: idSchema, boardId: idSchema.nullable() })),
  commandSchema('device.revoke', z.object({ deviceId: idSchema })),
  /** Only revoked Devices can be removed from the list. */
  commandSchema('device.remove', z.object({ deviceId: idSchema })),
]);
export type DeviceCommandDto = z.infer<typeof deviceCommandSchema>;

export const deviceListResponseSchema = z.object({
  devices: z.array(deviceSnapshotSchema),
  /** Boards a Device in this scope may be assigned (scope's own and its Shows' Boards). */
  assignableBoards: z.array(
    z.object({ id: idSchema, name: z.string(), owner: z.string(), preset: boardPresetSchema }),
  ),
});
export type DeviceListResponse = z.infer<typeof deviceListResponseSchema>;
export const deviceCommandResponseSchema = deviceListResponseSchema.extend({
  createdId: z.string().nullable(),
});
export type DeviceCommandResponse = z.infer<typeof deviceCommandResponseSchema>;

/** What a paired display receives: its identity and the projection of its assigned Board. */
export const deviceDisplaySnapshotSchema = z.object({
  device: z.object({ id: idSchema, name: z.string() }),
  board: boardStateSnapshotSchema.nullable(),
  serverTime: epochMsSchema,
});
export type DeviceDisplaySnapshot = z.infer<typeof deviceDisplaySnapshotSchema>;

// --- Board share management ----------------------------------------------------------------

export const boardShareCreateRequestSchema = z.object({
  boardId: idSchema.optional(),
  label: z.string().trim().max(80).optional(),
});
export const boardShareSnapshotSchema = z.object({
  id: idSchema,
  boardId: idSchema,
  boardName: z.string(),
  label: z.string().nullable(),
  createdAt: epochMsSchema,
  revokedAt: epochMsSchema.nullable(),
});
export type BoardShareSnapshot = z.infer<typeof boardShareSnapshotSchema>;
export const boardShareListResponseSchema = z.object({ shares: z.array(boardShareSnapshotSchema) });
export type BoardShareListResponse = z.infer<typeof boardShareListResponseSchema>;
