import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { boards, events, shows } from './show';

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date', precision: 3 });

/**
 * M5: persistent display Devices. Scope: an Event XOR a standalone Show. Only the hash of the
 * credential is stored; `last_seen_at` is written sparsely (connect/disconnect, every few
 * minutes), never per second. A revoked Device stays revoked.
 */
export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'cascade' }),
    showId: uuid('show_id').references(() => shows.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    assignedBoardId: uuid('assigned_board_id').references(() => boards.id, {
      onDelete: 'set null',
    }),
    credentialHash: text('credential_hash').unique(),
    createdAt: tstz('created_at').notNull(),
    lastSeenAt: tstz('last_seen_at'),
    revokedAt: tstz('revoked_at'),
    revision: integer('revision').notNull().default(0),
  },
  (t) => [
    check('devices_scope_check', sql`(${t.eventId} is null) <> (${t.showId} is null)`),
    index('devices_event_idx').on(t.eventId),
    index('devices_show_idx').on(t.showId),
  ],
);

/** M5: short-lived, one-time pairing sessions (hashes of the code and the display secret). */
export const devicePairings = pgTable(
  'device_pairings',
  {
    id: uuid('id').primaryKey(),
    codeHash: text('code_hash').notNull(),
    secretHash: text('secret_hash').notNull().unique(),
    status: text('status').notNull(),
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'cascade' }),
    createdAt: tstz('created_at').notNull(),
    expiresAt: tstz('expires_at').notNull(),
    pairedAt: tstz('paired_at'),
    claimedAt: tstz('claimed_at'),
  },
  (t) => [
    check('device_pairings_status_check', sql`${t.status} in ('pending', 'paired', 'claimed')`),
    index('device_pairings_code_idx').on(t.codeHash),
  ],
);
