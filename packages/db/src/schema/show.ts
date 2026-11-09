import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date', precision: 3 });

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
  },
  (t) => [index('queues_show_idx').on(t.showId)],
);

export const queueItems = pgTable(
  'queue_items',
  {
    id: uuid('id').primaryKey(),
    queueId: uuid('queue_id')
      .notNull()
      .references(() => queues.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [index('queue_items_queue_idx').on(t.queueId)],
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
