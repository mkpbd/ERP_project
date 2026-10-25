import { sql } from 'drizzle-orm';
import { check, date, index, integer, pgTable, text, time, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from '../../../identity/infrastructure/persistence/identity.schema.js';
import { staffRecords } from './hr.schema.js';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

// Old Payroll.TimedAttendanceLogs (written straight into the database by a device program) and
// HR.AttendanceRecords (pushed through the API). One row per raw punch.
export const attendancePunches = pgTable(
  'attendance_punches',
  {
    id: uuid('id').primaryKey(),
    biometricNo: integer('biometric_no').notNull(),
    /** Matched by biometric number when received; null until that number is assigned to someone. */
    staffId: uuid('staff_id').references(() => staffRecords.id, { onDelete: 'set null' }),
    machineNo: integer('machine_no').notNull().default(0),
    punchedAt: tz('punched_at').notNull(),
    receivedAt: tz('received_at').notNull().defaultNow(),
    receivedBy: uuid('received_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('attendance_punches_unique_uq').on(t.biometricNo, t.punchedAt),
    index('attendance_punches_staff_idx').on(t.staffId, t.punchedAt),
    index('attendance_punches_unmatched_idx')
      .on(t.biometricNo, t.punchedAt)
      .where(sql`${t.staffId} is null`),
  ],
);

// Old HR.ManualAttendances (+ ManualAttendanceLogs, now the audit trail).
export const manualAttendances = pgTable(
  'manual_attendances',
  {
    id: uuid('id').primaryKey(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staffRecords.id, { onDelete: 'restrict' }),
    attendanceDate: date('attendance_date', { mode: 'string' }).notNull(),
    inTime: time('in_time'),
    outTime: time('out_time'),
    reason: text('reason').notNull(),
    status: text('status', { enum: ['draft', 'pending', 'approved', 'rejected', 'cancelled'] }).notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }),
    submittedAt: tz('submitted_at'),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: tz('decided_at'),
    decisionRemarks: text('decision_remarks'),
    version: integer('version').notNull().default(1),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // One live entry per person and day (old "edit or cancel that entry instead of adding another").
    uniqueIndex('manual_attendances_live_uq')
      .on(t.staffId, t.attendanceDate)
      .where(sql`${t.status} <> 'cancelled'`),
    index('manual_attendances_status_idx').on(t.status, t.attendanceDate),
    check(
      'manual_attendances_status_ck',
      sql`${t.status} in ('draft', 'pending', 'approved', 'rejected', 'cancelled')`,
    ),
    check('manual_attendances_times_ck', sql`${t.inTime} is not null or ${t.outTime} is not null`),
    check(
      'manual_attendances_order_ck',
      sql`${t.inTime} is null or ${t.outTime} is null or ${t.outTime} > ${t.inTime}`,
    ),
  ],
);
