import { sql } from 'drizzle-orm';
import { check, index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { roles } from '../../../access-control/infrastructure/persistence/access-control.schema.js';
import { users } from '../../../identity/infrastructure/persistence/identity.schema.js';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

// Old API: SuperAdmin.ReportPermissions (RoleId → ReportAndSpId). Reports are defined in code, so the
// grant names the report key instead of a ReportAndSps row.
export const roleReports = pgTable(
  'role_reports',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    reportKey: text('report_key').notNull(),
    grantedAt: tz('granted_at').notNull().defaultNow(),
    grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    primaryKey({ name: 'role_reports_pk', columns: [t.roleId, t.reportKey] }),
    index('role_reports_report_idx').on(t.reportKey),
    check('role_reports_key_format_ck', sql`${t.reportKey} ~ '^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*)+$'`),
  ],
);
