import { z } from 'zod';
import { commandSchema, epochMsSchema, idSchema, revisionSchema } from './common';
import { MAX_DURATION_MS, timerSnapshotSchema } from './timer';

/** Mirrors the domain QUEUE_LIMITS. */
export const QUEUE_LIMITS = {
  items: 500,
  groups: 100,
  title: 200,
  subtitle: 200,
  notes: 4_000,
  tags: 20,
  tag: 40,
} as const;

export const thresholdRuleSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('percent'),
    warningPercent: z.int().min(0).max(100),
    criticalPercent: z.int().min(0).max(100),
  }),
  z.object({
    kind: z.literal('absolute'),
    warningMs: z.int().min(0).max(MAX_DURATION_MS),
    criticalMs: z.int().min(0).max(MAX_DURATION_MS),
  }),
]);
export type ThresholdRule = z.infer<typeof thresholdRuleSchema>;

export const thresholdSourceSchema = z.enum(['show', 'queue', 'item']);
export type ThresholdSource = z.infer<typeof thresholdSourceSchema>;

/** Effective setting plus its visible source (no hidden overrides, CLAUDE.md §6). */
export const resolvedThresholdsSchema = z.object({
  rule: thresholdRuleSchema,
  source: thresholdSourceSchema,
  inherited: z.object({ rule: thresholdRuleSchema, source: thresholdSourceSchema }),
});
export type ResolvedThresholdsDto = z.infer<typeof resolvedThresholdsSchema>;

export const startModeSchema = z.enum(['manual', 'on_previous_end']);
export const itemLifecycleSchema = z.enum(['current', 'completed', 'inactive', 'upcoming']);

const title = z.string().min(1).max(QUEUE_LIMITS.title);
const optionalText = (max: number) => z.string().max(max).nullable().optional();
const tags = z.array(z.string().max(QUEUE_LIMITS.tag)).max(QUEUE_LIMITS.tags);
const durationOrNone = z.int().positive().max(MAX_DURATION_MS).nullable();
const index = z.int().min(0).max(QUEUE_LIMITS.items);
const target = z.object({ queueItemId: idSchema });
const groupTarget = z.object({ groupId: idSchema });

// --- Item commands (queue.manage) -------------------------------------------------------------

/** Presets (Timer/Speaker/Note/Break) are UI only: they all send this same command. */
export const addItemCommandSchema = commandSchema(
  'item.add',
  z.object({
    title,
    subtitle: optionalText(QUEUE_LIMITS.subtitle),
    notes: optionalText(QUEUE_LIMITS.notes),
    tags: tags.optional(),
    durationMs: durationOrNone.optional(),
    active: z.boolean().optional(),
    startMode: startModeSchema.optional(),
    groupId: idSchema.nullable().optional(),
    index: index.optional(),
  }),
);

export const updateItemCommandSchema = commandSchema(
  'item.update',
  target.extend({
    patch: z.object({
      title: title.optional(),
      subtitle: optionalText(QUEUE_LIMITS.subtitle),
      notes: optionalText(QUEUE_LIMITS.notes),
      tags: tags.optional(),
      startMode: startModeSchema.optional(),
      durationMs: durationOrNone.optional(),
    }),
  }),
);
export const deleteItemCommandSchema = commandSchema('item.delete', target);
export const duplicateItemCommandSchema = commandSchema('item.duplicate', target);
export const moveItemCommandSchema = commandSchema(
  'item.move',
  target.extend({ groupId: idSchema.nullable(), index }),
);
export const setItemActiveCommandSchema = commandSchema(
  'item.setActive',
  target.extend({ active: z.boolean() }),
);
/** `warning: null` = Reset to inherited. */
export const setItemWarningCommandSchema = commandSchema(
  'item.setWarning',
  target.extend({ warning: thresholdRuleSchema.nullable() }),
);

// --- Live Queue operation (item.control) ------------------------------------------------------

export const setCurrentCommandSchema = commandSchema('queue.setCurrent', target);
/**
 * END (`next: false`) or END + NEXT (`next: true`). `queueItemId` must be the current item;
 * this is a Queue Item command — STOP stays a separate timer command.
 */
export const endItemCommandSchema = commandSchema('item.end', target.extend({ next: z.boolean() }));

// --- Groups (queue.manage) --------------------------------------------------------------------

export const addGroupCommandSchema = commandSchema(
  'group.add',
  z.object({ title, index: index.optional() }),
);
export const renameGroupCommandSchema = commandSchema(
  'group.rename',
  groupTarget.extend({ title }),
);
export const deleteGroupCommandSchema = commandSchema('group.delete', groupTarget);
export const duplicateGroupCommandSchema = commandSchema('group.duplicate', groupTarget);
export const moveGroupCommandSchema = commandSchema('group.move', groupTarget.extend({ index }));

// --- Inherited settings -----------------------------------------------------------------------

/** Queue override (queue.manage); `warning: null` = Reset to Show default. */
export const setQueueWarningCommandSchema = commandSchema(
  'queue.setWarning',
  z.object({ warning: thresholdRuleSchema.nullable() }),
);
/** Show default (show.manage); always a rule. */
export const setShowWarningCommandSchema = commandSchema(
  'show.setWarning',
  z.object({ warning: thresholdRuleSchema }),
);

export const queueCommandSchema = z.discriminatedUnion('type', [
  addItemCommandSchema,
  updateItemCommandSchema,
  deleteItemCommandSchema,
  duplicateItemCommandSchema,
  moveItemCommandSchema,
  setItemActiveCommandSchema,
  setItemWarningCommandSchema,
  setCurrentCommandSchema,
  endItemCommandSchema,
  addGroupCommandSchema,
  renameGroupCommandSchema,
  deleteGroupCommandSchema,
  duplicateGroupCommandSchema,
  moveGroupCommandSchema,
  setQueueWarningCommandSchema,
  setShowWarningCommandSchema,
]);
export type QueueCommandDto = z.infer<typeof queueCommandSchema>;
export type QueueCommandType = QueueCommandDto['type'];

// --- Snapshots --------------------------------------------------------------------------------

export const queueItemSnapshotSchema = z.object({
  id: idSchema,
  groupId: idSchema.nullable(),
  title: z.string(),
  subtitle: z.string().nullable(),
  notes: z.string().nullable(),
  tags: z.array(z.string()),
  position: z.int().nonnegative(),
  active: z.boolean(),
  completedAt: epochMsSchema.nullable(),
  lifecycle: itemLifecycleSchema,
  startMode: startModeSchema,
  /** The item's own override (null = inherits). */
  warning: thresholdRuleSchema.nullable(),
  /** Effective thresholds with source. */
  effectiveWarning: resolvedThresholdsSchema,
  timer: timerSnapshotSchema.nullable(),
  createdAt: epochMsSchema,
  updatedAt: epochMsSchema,
  revision: revisionSchema,
});
export type QueueItemSnapshot = z.infer<typeof queueItemSnapshotSchema>;

export const groupSnapshotSchema = z.object({
  id: idSchema,
  title: z.string(),
  position: z.int().nonnegative(),
});
export type GroupSnapshot = z.infer<typeof groupSnapshotSchema>;

/**
 * Authoritative Queue projection for management clients. Items are listed in operational order
 * (groups expanded in place). `nextItemId` is derived by the server with the same domain rule
 * clients would use; it is not stored. Clients drop any snapshot with an older `revision`.
 */
export const queueSnapshotSchema = z.object({
  id: idSchema,
  name: z.string(),
  revision: revisionSchema,
  currentItemId: idSchema.nullable(),
  nextItemId: idSchema.nullable(),
  showWarning: thresholdRuleSchema,
  warning: thresholdRuleSchema.nullable(),
  effectiveWarning: resolvedThresholdsSchema,
  groups: z.array(groupSnapshotSchema),
  items: z.array(queueItemSnapshotSchema),
  serverTime: epochMsSchema,
});
export type QueueSnapshot = z.infer<typeof queueSnapshotSchema>;

/** Response of an accepted Queue command: the authoritative Queue after the change. */
export const queueCommandResponseSchema = z.object({
  queue: queueSnapshotSchema,
  /** Id of the item/group created by add/duplicate commands, else null. */
  createdId: idSchema.nullable(),
});
export type QueueCommandResponse = z.infer<typeof queueCommandResponseSchema>;
