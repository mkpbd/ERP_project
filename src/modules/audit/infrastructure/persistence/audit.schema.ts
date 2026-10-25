import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// No foreign key to users: audit history must survive account removal.
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    actorUserId: uuid('actor_user_id'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    outcome: text('outcome', { enum: ['success', 'failure', 'denied'] }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    requestId: text('request_id'),
    correlationId: text('correlation_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index('audit_logs_occurred_at_idx').on(t.occurredAt.desc()),
    index('audit_logs_actor_idx').on(t.actorUserId, t.occurredAt.desc()),
    index('audit_logs_resource_idx').on(t.resourceType, t.resourceId),
    index('audit_logs_action_idx').on(t.action),
    check('audit_logs_outcome_ck', sql`${t.outcome} in ('success', 'failure', 'denied')`),
  ],
);
