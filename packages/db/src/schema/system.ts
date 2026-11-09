import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Infrastructure-only table that proves the migration toolchain in M0.
 * Product tables (Show, Queue, Queue Item, ...) are introduced by the milestone that needs them.
 */
export const systemMeta = pgTable('system_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});
