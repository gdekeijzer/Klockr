import { z } from 'zod';
import { commandSchema, epochMsSchema, idSchema, revisionSchema } from './common';
import { audienceSchema, thresholdRuleSchema } from './queue';
import { timerSnapshotSchema } from './timer';

export const boardPresetSchema = z.enum([
  'speaker_confidence',
  'stage_manager',
  'production',
  'backstage',
  'room_agenda',
  'public_agenda',
  'custom',
]);
export type BoardPresetDto = z.infer<typeof boardPresetSchema>;

export const boardComponentKindSchema = z.enum([
  'message',
  'current_title',
  'subtitle',
  'timer',
  'progress',
  'next_item',
  'wall_clock',
  'show_offset',
  'queue_current_next',
  'running_timers',
  'agenda',
  'anchor',
  'notes',
]);
export type BoardComponentKindDto = z.infer<typeof boardComponentKindSchema>;

/** Constrained component configuration: no free canvas, no pixel coordinates. */
export const boardComponentSchema = z.object({
  kind: boardComponentKindSchema,
  enabled: z.boolean(),
  size: z.enum(['small', 'medium', 'large']),
  upcoming: z.int().min(0).max(20),
});
export type BoardComponentDto = z.infer<typeof boardComponentSchema>;

export const boardSourcesSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('primary') }),
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('selected'), queueIds: z.array(idSchema).min(1).max(20) }),
]);
export type BoardSourcesDto = z.infer<typeof boardSourcesSchema>;

export const boardPresentationSchema = z.object({
  lowLight: z.boolean(),
  showTimes: z.boolean(),
});

/** Board configuration as management clients see it. */
export const boardConfigSchema = z.object({
  id: idSchema,
  name: z.string(),
  preset: boardPresetSchema,
  audience: audienceSchema,
  sources: boardSourcesSchema,
  components: z.array(boardComponentSchema),
  presentation: boardPresentationSchema,
  revision: revisionSchema,
});
export type BoardConfigDto = z.infer<typeof boardConfigSchema>;

// --- Board commands (board.manage) and messages (message.send) --------------------------------

export const createBoardCommandSchema = commandSchema(
  'board.create',
  z.object({ preset: boardPresetSchema, name: z.string().trim().min(1).max(100).optional() }),
);
export const updateBoardCommandSchema = commandSchema(
  'board.update',
  z.object({
    boardId: idSchema,
    name: z.string().trim().min(1).max(100).optional(),
    audience: audienceSchema.optional(),
    sources: boardSourcesSchema.optional(),
    components: z.array(boardComponentSchema).max(20).optional(),
    presentation: boardPresentationSchema.partial().optional(),
  }),
);
export const deleteBoardCommandSchema = commandSchema(
  'board.delete',
  z.object({ boardId: idSchema }),
);

export const messagePrioritySchema = z.enum(['normal', 'urgent']);
export const sendMessageCommandSchema = commandSchema(
  'message.send',
  z.object({
    text: z.string().trim().min(1).max(120),
    audiences: z.array(audienceSchema).max(5),
    boardIds: z.array(idSchema).max(50).optional(),
    priority: messagePrioritySchema,
    /** Auto-expiry; omitted = until cleared. */
    ttlMs: z.int().positive().max(86_400_000).nullable().optional(),
  }),
);
export const clearMessageCommandSchema = commandSchema(
  'message.clear',
  z.object({ messageId: idSchema }),
);

export const boardCommandSchema = z.discriminatedUnion('type', [
  createBoardCommandSchema,
  updateBoardCommandSchema,
  deleteBoardCommandSchema,
  sendMessageCommandSchema,
  clearMessageCommandSchema,
]);
export type BoardCommandDto = z.infer<typeof boardCommandSchema>;

export const messageSnapshotSchema = z.object({
  id: idSchema,
  text: z.string(),
  audiences: z.array(audienceSchema),
  boardIds: z.array(idSchema),
  priority: messagePrioritySchema,
  createdAt: epochMsSchema,
  expiresAt: epochMsSchema.nullable(),
});
export type MessageSnapshot = z.infer<typeof messageSnapshotSchema>;

// --- Board projection (what a Board token receives) -------------------------------------------

/** A visible item on a Board: display fields only (never notes unless explicitly published). */
export const boardItemSchema = z.object({
  id: idSchema,
  title: z.string(),
  subtitle: z.string().nullable(),
  durationMs: z.int().nonnegative().nullable(),
  plannedStart: epochMsSchema.nullable(),
  projectedStart: epochMsSchema.nullable(),
  fixedAnchor: z.boolean(),
});
export type BoardItem = z.infer<typeof boardItemSchema>;

export const boardQueueSchema = z.object({
  id: idSchema,
  name: z.string(),
  discipline: z.string().nullable(),
  isPrimary: z.boolean(),
  /** Visible Current, or null (nothing current or not visible to this audience). */
  current: boardItemSchema.nullable(),
  /**
   * True when the Queue HAS a Current that is not visible to this Board's audience: the Board
   * renders STAND BY. No data of the hidden item is ever included.
   */
  standBy: z.boolean(),
  /** Published notes of the current item (only with a Notes component AND explicit audience). */
  currentNotes: z.string().nullable(),
  next: boardItemSchema.nullable(),
  upcoming: z.array(boardItemSchema),
  /** Timers of visible items of this Queue (current first, then other running ones). */
  timers: z.array(timerSnapshotSchema),
  warning: thresholdRuleSchema,
  offsetMs: z.int().nullable(),
  /**
   * When the current running timer reaches zero; after this instant the offset and projected
   * times of later items grow 1:1 with time (clients extrapolate, no ticks are sent).
   */
  growsAfter: epochMsSchema.nullable(),
  toleranceMs: z.int().nonnegative(),
  severeBehindMs: z.int().nonnegative(),
  anchor: z
    .object({
      title: z.string(),
      plannedStart: epochMsSchema,
      recoveryMs: z.int().nonnegative(),
      recoverableMs: z.int().nonnegative(),
    })
    .nullable(),
  locked: z.boolean(),
  /** Pending suggested follow INTO this Queue (titles only when visible). */
  suggestion: z
    .object({ id: idSchema, targetTitle: z.string(), sourceQueueName: z.string() })
    .nullable(),
});
export type BoardQueue = z.infer<typeof boardQueueSchema>;

export const boardStateSnapshotSchema = z.object({
  board: z.object({
    id: idSchema,
    name: z.string(),
    preset: boardPresetSchema,
    audience: audienceSchema,
    components: z.array(boardComponentSchema),
    presentation: boardPresentationSchema,
  }),
  /** Show revision this projection was built from (monotonic; older ones are dropped). */
  version: revisionSchema,
  timeZone: z.string(),
  queues: z.array(boardQueueSchema),
  messages: z.array(messageSnapshotSchema),
  serverTime: epochMsSchema,
});
export type BoardStateSnapshot = z.infer<typeof boardStateSnapshotSchema>;
