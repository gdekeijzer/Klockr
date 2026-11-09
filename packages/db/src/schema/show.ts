import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  uniqueIndex,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date', precision: 3 });

/** Timer warning threshold rule as JSON: {kind:'percent',...} | {kind:'absolute',...}. */
export interface ThresholdRuleJson {
  readonly kind: 'percent' | 'absolute';
  readonly warningPercent?: number;
  readonly criticalPercent?: number;
  readonly warningMs?: number;
  readonly criticalMs?: number;
}
const DEFAULT_RULE = sql`'{"kind":"percent","warningPercent":20,"criticalPercent":5}'::jsonb`;

/** Standalone operational unit. M1: anonymous Quick Timer Shows only. */
export const shows = pgTable(
  'shows',
  {
    id: uuid('id').primaryKey(),
    title: text('title').notNull(),
    ownership: text('ownership').notNull(),
    primaryQueueId: uuid('primary_queue_id').notNull(),
    createdAt: tstz('created_at').notNull(),
    lastActiveAt: tstz('last_active_at').notNull(),
    /** Anonymous cleanup eligibility, not a deletion time. */
    expiresAt: tstz('expires_at').notNull(),
    /** Show default warning thresholds (top of the inheritance chain). */
    warningRule: jsonb('warning_rule').$type<ThresholdRuleJson>().notNull().default(DEFAULT_RULE),
    /** M3 schedule settings. Human times are entered in `time_zone` on `schedule_date`. */
    timingMode: text('timing_mode').notNull().default('strict'),
    timeZone: text('time_zone').notNull().default('UTC'),
    scheduleDate: text('schedule_date'),
    toleranceMs: integer('tolerance_ms').notNull().default(30_000),
    severeBehindMs: integer('severe_behind_ms').notNull().default(300_000),
    /** M4: compare-and-set revision of the whole Show aggregate. */
    revision: integer('revision').notNull().default(0),
  },
  (t) => [
    check('shows_timing_mode_check', sql`${t.timingMode} in ('strict', 'sliding')`),
    check('shows_ownership_check', sql`${t.ownership} in ('anonymous')`),
    index('shows_expires_at_idx').on(t.expiresAt),
  ],
);

export const queues = pgTable(
  'queues',
  {
    id: uuid('id').primaryKey(),
    showId: uuid('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Legacy M1-M3 column (always 'program'); superseded by `discipline` since M4. */
    purpose: text('purpose').notNull().default('program'),
    /** Optional discipline label (identifier, never a state colour). */
    discipline: text('discipline'),
    /** Display order among the Show's peer Queues. */
    position: integer('position').notNull(),
    /** Operational current position; `next` is derived, never stored. */
    currentItemId: uuid('current_item_id').references((): AnyPgColumn => queueItems.id, {
      onDelete: 'set null',
    }),
    /** Queue override of the Show default; null inherits. */
    warningRule: jsonb('warning_rule').$type<ThresholdRuleJson>(),
    /** Compare-and-set guard for the Queue aggregate (structure, current, lifecycle). */
    revision: integer('revision').notNull().default(0),
    /** Queue override of the Show timing mode; null inherits. */
    timingMode: text('timing_mode'),
  },
  (t) => [
    index('queues_show_idx').on(t.showId),
    check(
      'queues_timing_mode_check',
      sql`${t.timingMode} is null or ${t.timingMode} in ('strict', 'sliding')`,
    ),
  ],
);

/** Real container of Queue Items within one Queue (one level, no nesting). */
export const queueGroups = pgTable(
  'queue_groups',
  {
    id: uuid('id').primaryKey(),
    queueId: uuid('queue_id')
      .notNull()
      .references(() => queues.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** Position among the Queue's top-level entries (items without group and groups). */
    position: integer('position').notNull(),
    createdAt: tstz('created_at').notNull(),
    updatedAt: tstz('updated_at').notNull(),
  },
  (t) => [index('queue_groups_queue_idx').on(t.queueId)],
);

export const queueItems = pgTable(
  'queue_items',
  {
    id: uuid('id').primaryKey(),
    queueId: uuid('queue_id')
      .notNull()
      .references(() => queues.id, { onDelete: 'cascade' }),
    /** Containing Group; null = top level. Deleting a Group deletes its items. */
    groupId: uuid('group_id').references(() => queueGroups.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    subtitle: text('subtitle'),
    notes: text('notes'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Position within its container (Group or Queue top level). */
    position: integer('position').notNull(),
    active: boolean('active').notNull().default(true),
    completedAt: tstz('completed_at'),
    startMode: text('start_mode').notNull().default('manual'),
    /** Item override of the inherited warning thresholds; null inherits. */
    warningRule: jsonb('warning_rule').$type<ThresholdRuleJson>(),
    /** Planned (baseline) start, only when explicitly set; null = chained (derived). */
    plannedStartAt: tstz('planned_start_at'),
    /** Planned duration for items without timer (timed items use the timer duration). */
    plannedDurationMs: bigint('planned_duration_ms', { mode: 'number' }),
    fixedAnchor: boolean('fixed_anchor').notNull().default(false),
    /** Actuals: written once by operational commands, never rewritten. */
    actualStartAt: tstz('actual_start_at'),
    actualEndAt: tstz('actual_end_at'),
    /** Audiences that may see the item on Boards; NULL = everyone (backward compatible). */
    visibility: text('visibility').array(),
    /** Audiences the notes PROPERTY is published to; default none. */
    notesAudiences: text('notes_audiences')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
    revision: integer('revision').notNull().default(0),
  },
  (t) => [
    index('queue_items_queue_idx').on(t.queueId),
    index('queue_items_group_idx').on(t.groupId),
    check(
      'queue_items_start_mode_check',
      sql`${t.startMode} in ('manual', 'on_previous_end', 'scheduled')`,
    ),
  ],
);

/**
 * Timer capability of a Queue Item: transitions and timestamps only, never ticks.
 * Overtime is derived and has no column. `revision` guards compare-and-set writes.
 */
export const itemTimers = pgTable(
  'item_timers',
  {
    queueItemId: uuid('queue_item_id')
      .primaryKey()
      .references(() => queueItems.id, { onDelete: 'cascade' }),
    mode: text('mode').notNull(),
    status: text('status').notNull(),
    durationMs: bigint('duration_ms', { mode: 'number' }).notNull(),
    adjustmentMs: bigint('adjustment_ms', { mode: 'number' }).notNull(),
    startedAt: tstz('started_at'),
    pausedAt: tstz('paused_at'),
    pausedTotalMs: bigint('paused_total_ms', { mode: 'number' }).notNull(),
    stoppedAt: tstz('stopped_at'),
    revision: integer('revision').notNull(),
    updatedAt: tstz('updated_at').notNull(),
  },
  (t) => [
    check('item_timers_mode_check', sql`${t.mode} in ('countdown', 'countup')`),
    check('item_timers_status_check', sql`${t.status} in ('idle', 'running', 'paused', 'stopped')`),
  ],
);

/** Presentation definition. M1: one Speaker Board per Show, no layout configuration yet. */
export const boards = pgTable(
  'boards',
  {
    id: uuid('id').primaryKey(),
    showId: uuid('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    preset: text('preset').notNull(),
    name: text('name').notNull().default('Speaker Board'),
    /** Exactly one primary audience. */
    audience: text('audience').notNull().default('stage'),
    /** true = source is the Show's Primary Queue; false = `board_sources`. */
    followPrimary: boolean('follow_primary').notNull().default(true),
    /**
     * Constrained component configuration (versioned presentation JSON, validated by the domain):
     * [{ kind, enabled, size, upcoming }] in presentation order. Empty = preset defaults.
     */
    components: jsonb('components')
      .$type<BoardComponentJson[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    presentation: jsonb('presentation')
      .$type<{ lowLight: boolean; showTimes: boolean }>()
      .notNull()
      .default(sql`'{"lowLight":false,"showTimes":true}'::jsonb`),
    createdAt: tstz('created_at').notNull(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
    revision: integer('revision').notNull().default(0),
  },
  (t) => [
    index('boards_show_idx').on(t.showId),
    check(
      'boards_preset_check',
      sql`${t.preset} in ('speaker_confidence', 'stage_manager', 'production', 'backstage', 'room_agenda', 'public_agenda', 'custom')`,
    ),
    check(
      'boards_audience_check',
      sql`${t.audience} in ('stage', 'production', 'backstage', 'public', 'broadcast')`,
    ),
  ],
);

export interface BoardComponentJson {
  readonly kind: string;
  readonly enabled: boolean;
  readonly size: 'small' | 'medium' | 'large';
  readonly upcoming: number;
}

/** Ordered source Queues of a Board that does not follow the Primary Queue. */
export const boardSources = pgTable(
  'board_sources',
  {
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    queueId: uuid('queue_id')
      .notNull()
      .references(() => queues.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.boardId, t.queueId] })],
);

/** Cross-Queue relations (synchronization metadata, never ownership). */
export const itemRelations = pgTable(
  'item_relations',
  {
    id: uuid('id').primaryKey(),
    showId: uuid('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    sourceItemId: uuid('source_item_id')
      .notNull()
      .references(() => queueItems.id, { onDelete: 'cascade' }),
    targetItemId: uuid('target_item_id')
      .notNull()
      .references(() => queueItems.id, { onDelete: 'cascade' }),
    offsetMs: bigint('offset_ms', { mode: 'number' }).notNull(),
    preserveOffset: boolean('preserve_offset').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: tstz('created_at').notNull(),
    updatedAt: tstz('updated_at').notNull(),
    revision: integer('revision').notNull().default(0),
  },
  (t) => [
    index('item_relations_show_idx').on(t.showId),
    uniqueIndex('item_relations_pair_uq').on(t.sourceItemId, t.targetItemId),
  ],
);

/** Suggested follow (durable runtime state; resolved rows are kept with their status). */
export const queueSuggestions = pgTable(
  'queue_suggestions',
  {
    id: uuid('id').primaryKey(),
    showId: uuid('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    relationId: uuid('relation_id').notNull(),
    sourceQueueId: uuid('source_queue_id').notNull(),
    sourceItemId: uuid('source_item_id').notNull(),
    targetQueueId: uuid('target_queue_id').notNull(),
    targetItemId: uuid('target_item_id').notNull(),
    targetCurrentAtCreation: uuid('target_current_at_creation'),
    createdAt: tstz('created_at').notNull(),
    status: text('status').notNull(),
    resolvedAt: tstz('resolved_at'),
  },
  (t) => [
    index('queue_suggestions_show_status_idx').on(t.showId, t.status),
    check(
      'queue_suggestions_status_check',
      sql`${t.status} in ('pending', 'accepted', 'ignored', 'stale')`,
    ),
  ],
);

/** Ad-hoc Board messages (not Queue Items). */
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey(),
    showId: uuid('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    audiences: text('audiences').array().notNull(),
    boardIds: uuid('board_ids').array().notNull(),
    priority: text('priority').notNull(),
    createdAt: tstz('created_at').notNull(),
    expiresAt: tstz('expires_at'),
    clearedAt: tstz('cleared_at'),
  },
  (t) => [
    index('messages_show_idx').on(t.showId),
    check('messages_priority_check', sql`${t.priority} in ('normal', 'urgent')`),
  ],
);

/**
 * Typed access grants. The secret credential is never stored, only its SHA-256 hash.
 * Grant kinds have explicit scope: anonymous_owner -> Show; board_share -> one Board.
 */
export const accessGrants = pgTable(
  'access_grants',
  {
    id: uuid('id').primaryKey(),
    kind: text('kind').notNull(),
    showId: uuid('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    boardId: uuid('board_id').references(() => boards.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: tstz('created_at').notNull(),
    expiresAt: tstz('expires_at'),
    revokedAt: tstz('revoked_at'),
  },
  (t) => [
    check('access_grants_kind_check', sql`${t.kind} in ('anonymous_owner', 'board_share')`),
    check(
      'access_grants_scope_check',
      sql`(${t.kind} = 'board_share') = (${t.boardId} is not null)`,
    ),
    index('access_grants_show_idx').on(t.showId),
  ],
);

/** Remembered outcomes of commands sent with an idempotency key. */
export const idempotencyRecords = pgTable(
  'idempotency_records',
  {
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    fingerprint: text('fingerprint').notNull(),
    result: jsonb('result').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.key] })],
);

const lockKind = (column: AnyPgColumn) => sql`${column} in ('show', 'queue', 'group', 'item')`;

/**
 * Structure/configuration locks. Part of the Queue aggregate (`queue_id`), so lock checks and
 * the mutations they guard are committed together. One own lock per target.
 */
export const locks = pgTable(
  'locks',
  {
    id: uuid('id').primaryKey(),
    showId: uuid('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    queueId: uuid('queue_id')
      .notNull()
      .references(() => queues.id, { onDelete: 'cascade' }),
    targetKind: text('target_kind').notNull(),
    targetId: uuid('target_id').notNull(),
    lockedAt: tstz('locked_at').notNull(),
    lockedByKind: text('locked_by_kind').notNull(),
    lockedById: text('locked_by_id').notNull(),
  },
  (t) => [
    check('locks_target_kind_check', lockKind(t.targetKind)),
    uniqueIndex('locks_target_uq').on(t.targetKind, t.targetId),
    index('locks_queue_idx').on(t.queueId),
  ],
);

/** Request Unlock records. Kept after resolution (`resolved_at`) for history. */
export const unlockRequests = pgTable(
  'unlock_requests',
  {
    id: uuid('id').primaryKey(),
    showId: uuid('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    queueId: uuid('queue_id')
      .notNull()
      .references(() => queues.id, { onDelete: 'cascade' }),
    lockId: uuid('lock_id').notNull(),
    targetKind: text('target_kind').notNull(),
    targetId: uuid('target_id').notNull(),
    requestedAt: tstz('requested_at').notNull(),
    requestedByKind: text('requested_by_kind').notNull(),
    requestedById: text('requested_by_id').notNull(),
    reason: text('reason'),
    resolvedAt: tstz('resolved_at'),
  },
  (t) => [
    check('unlock_requests_target_kind_check', lockKind(t.targetKind)),
    index('unlock_requests_queue_idx').on(t.queueId),
  ],
);

/** Append-only audit trail (locks, overrides, planning, anchors, timing modes). */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey(),
    /** Insertion order (stable ordering for records with equal timestamps). */
    seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity(),
    showId: uuid('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    at: tstz('at').notNull(),
    actorKind: text('actor_kind').notNull(),
    actorId: text('actor_id').notNull(),
    action: text('action').notNull(),
    resourceKind: text('resource_kind').notNull(),
    resourceId: text('resource_id').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull(),
  },
  (t) => [index('audit_events_show_at_idx').on(t.showId, t.at)],
);
