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
  },
  (t) => [
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
    purpose: text('purpose').notNull(),
    position: integer('position').notNull(),
    /** Operational current position; `next` is derived, never stored. */
    currentItemId: uuid('current_item_id').references((): AnyPgColumn => queueItems.id, {
      onDelete: 'set null',
    }),
    /** Queue override of the Show default; null inherits. */
    warningRule: jsonb('warning_rule').$type<ThresholdRuleJson>(),
    /** Compare-and-set guard for the Queue aggregate (structure, current, lifecycle). */
    revision: integer('revision').notNull().default(0),
  },
  (t) => [index('queues_show_idx').on(t.showId)],
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
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
    revision: integer('revision').notNull().default(0),
  },
  (t) => [
    index('queue_items_queue_idx').on(t.queueId),
    index('queue_items_group_idx').on(t.groupId),
    check('queue_items_start_mode_check', sql`${t.startMode} in ('manual', 'on_previous_end')`),
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
    createdAt: tstz('created_at').notNull(),
  },
  (t) => [index('boards_show_idx').on(t.showId)],
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
