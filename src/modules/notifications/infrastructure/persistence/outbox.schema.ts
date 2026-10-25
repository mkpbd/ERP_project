import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const outboxMessages = pgTable(
  'outbox_messages',
  {
    id: uuid('id').primaryKey(),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status', { enum: ['pending', 'sent', 'failed'] })
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    index('outbox_messages_pending_idx')
      .on(t.availableAt)
      .where(sql`${t.status} = 'pending'`),
    check('outbox_messages_status_ck', sql`${t.status} in ('pending', 'sent', 'failed')`),
    check('outbox_messages_attempts_ck', sql`${t.attempts} >= 0`),
  ],
);
