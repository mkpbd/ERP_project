import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from '../../../identity/infrastructure/persistence/identity.schema.js';
import { hrDepartments, staffRecords } from './hr.schema.js';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const day = (name: string) => date(name, { mode: 'string' });
const timestamps = {
  createdAt: tz('created_at').notNull().defaultNow(),
  updatedAt: tz('updated_at').notNull().defaultNow(),
};
const policyTerms = {
  lateGraceMinutes: smallint('late_grace_minutes').notNull().default(0),
  lateCountPerDeduction: smallint('late_count_per_deduction').notNull().default(0),
  absentDeduction: boolean('absent_deduction').notNull().default(false),
};

// Old HR.LeaveTypes (int ids).
export const leaveTypes = pgTable(
  'leave_types',
  {
    id: uuid('id').primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    nameBn: text('name_bn'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('leave_types_code_uq').on(sql`upper(${t.code})`),
    uniqueIndex('leave_types_name_uq').on(sql`lower(${t.name})`),
    check('leave_types_code_ck', sql`${t.code} ~ '^[A-Za-z][A-Za-z0-9-]{0,9}$'`),
  ],
);

// Old HR.LeavePolicies (one per year, fixed CL/ML/... columns) → terms + one row per leave type.
export const leavePolicies = pgTable(
  'leave_policies',
  {
    year: smallint('year').primaryKey(),
    ...policyTerms,
    updatedAt: tz('updated_at').notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [check('leave_policies_year_ck', sql`${t.year} between 2000 and 2100`)],
);

export const leavePolicyEntitlements = pgTable(
  'leave_policy_entitlements',
  {
    year: smallint('year')
      .notNull()
      .references(() => leavePolicies.year, { onDelete: 'cascade' }),
    leaveTypeId: uuid('leave_type_id')
      .notNull()
      .references(() => leaveTypes.id, { onDelete: 'restrict' }),
    days: smallint('days').notNull(),
  },
  (t) => [
    primaryKey({ name: 'leave_policy_entitlements_pk', columns: [t.year, t.leaveTypeId] }),
    check('leave_policy_entitlements_days_ck', sql`${t.days} between 0 and 366`),
  ],
);

// Old HR.IndividualEmployeeLeavePolices + IndividualEmployeeLeaveEligibles: replaces the year's policy for one person.
export const staffLeavePolicies = pgTable(
  'staff_leave_policies',
  {
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staffRecords.id, { onDelete: 'cascade' }),
    year: smallint('year').notNull(),
    ...policyTerms,
    updatedAt: tz('updated_at').notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    primaryKey({ name: 'staff_leave_policies_pk', columns: [t.staffId, t.year] }),
    check('staff_leave_policies_year_ck', sql`${t.year} between 2000 and 2100`),
  ],
);

export const staffLeaveEntitlements = pgTable(
  'staff_leave_entitlements',
  {
    staffId: uuid('staff_id').notNull(),
    year: smallint('year').notNull(),
    leaveTypeId: uuid('leave_type_id')
      .notNull()
      .references(() => leaveTypes.id, { onDelete: 'restrict' }),
    days: smallint('days').notNull(),
  },
  (t) => [
    primaryKey({ name: 'staff_leave_entitlements_pk', columns: [t.staffId, t.year, t.leaveTypeId] }),
    foreignKey({
      name: 'staff_leave_entitlements_policy_fk',
      columns: [t.staffId, t.year],
      foreignColumns: [staffLeavePolicies.staffId, staffLeavePolicies.year],
    }).onDelete('cascade'),
    check('staff_leave_entitlements_days_ck', sql`${t.days} between 0 and 366`),
  ],
);

// Old HR.LeaveApprovalSettings: a department's approval chain, level 1 first. The last level decides.
export const leaveApprovalLevels = pgTable(
  'leave_approval_levels',
  {
    id: uuid('id').primaryKey(),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => hrDepartments.id, { onDelete: 'restrict' }),
    levelOrder: smallint('level_order').notNull(),
    name: text('name').notNull(),
    approverStaffId: uuid('approver_staff_id')
      .notNull()
      .references(() => staffRecords.id, { onDelete: 'restrict' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('leave_approval_levels_department_order_uq').on(t.departmentId, t.levelOrder),
    index('leave_approval_levels_approver_idx').on(t.approverStaffId),
    check('leave_approval_levels_order_ck', sql`${t.levelOrder} between 1 and 20`),
  ],
);

// Old HR.ApplicationPermissions: who may apply for leave on someone else's behalf.
export const leaveDelegates = pgTable(
  'leave_delegates',
  {
    id: uuid('id').primaryKey(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staffRecords.id, { onDelete: 'cascade' }),
    onBehalfOfStaffId: uuid('on_behalf_of_staff_id')
      .notNull()
      .references(() => staffRecords.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('leave_delegates_pair_uq').on(t.staffId, t.onBehalfOfStaffId),
    index('leave_delegates_on_behalf_idx').on(t.onBehalfOfStaffId),
    check('leave_delegates_not_self_ck', sql`${t.staffId} <> ${t.onBehalfOfStaffId}`),
  ],
);

// Old HR.LeaveApplications.
export const leaveApplications = pgTable(
  'leave_applications',
  {
    id: uuid('id').primaryKey(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staffRecords.id, { onDelete: 'restrict' }),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => hrDepartments.id, { onDelete: 'restrict' }),
    leaveTypeId: uuid('leave_type_id')
      .notNull()
      .references(() => leaveTypes.id, { onDelete: 'restrict' }),
    startDate: day('start_date').notNull(),
    endDate: day('end_date').notNull(),
    days: smallint('days').notNull(),
    reason: text('reason').notNull(),
    substituteStaffId: uuid('substitute_staff_id').references(() => staffRecords.id, { onDelete: 'set null' }),
    status: text('status', { enum: ['pending', 'approved', 'rejected', 'cancelled'] }).notNull(),
    currentLevel: smallint('current_level').notNull(),
    levelCount: smallint('level_count').notNull(),
    approvedStartDate: day('approved_start_date'),
    approvedEndDate: day('approved_end_date'),
    approvedDays: smallint('approved_days'),
    decisionReason: text('decision_reason'),
    submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }),
    submittedAt: tz('submitted_at').notNull(),
    decidedAt: tz('decided_at'),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    index('leave_applications_staff_idx').on(t.staffId, t.startDate),
    index('leave_applications_pending_idx')
      .on(t.departmentId, t.currentLevel)
      .where(sql`${t.status} = 'pending'`),
    check('leave_applications_status_ck', sql`${t.status} in ('pending', 'approved', 'rejected', 'cancelled')`),
    check(
      'leave_applications_period_ck',
      sql`${t.endDate} >= ${t.startDate} and extract(year from ${t.startDate}) = extract(year from ${t.endDate})`,
    ),
    check('leave_applications_days_ck', sql`${t.days} = ${t.endDate} - ${t.startDate} + 1`),
    check(
      'leave_applications_approved_ck',
      sql`${t.status} <> 'approved' or (${t.approvedStartDate} >= ${t.startDate} and ${t.approvedEndDate} <= ${t.endDate})`,
    ),
  ],
);

// Old HR.LeaveApproveOnDifferentLevels.
export const leaveApplicationApprovals = pgTable(
  'leave_application_approvals',
  {
    id: uuid('id').primaryKey(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => leaveApplications.id, { onDelete: 'cascade' }),
    levelOrder: smallint('level_order').notNull(),
    decision: text('decision', { enum: ['approved', 'rejected'] }).notNull(),
    approverStaffId: uuid('approver_staff_id').references(() => staffRecords.id, { onDelete: 'set null' }),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    startDate: day('start_date'),
    endDate: day('end_date'),
    remarks: text('remarks'),
    decidedAt: tz('decided_at').notNull(),
  },
  (t) => [
    uniqueIndex('leave_application_approvals_level_uq').on(t.applicationId, t.levelOrder),
    check('leave_application_approvals_decision_ck', sql`${t.decision} in ('approved', 'rejected')`),
  ],
);

// Old HR.LeaveRecords and HR.MaternityLeaveRecords: leave entered directly by HR (not through an application).
export const leaveRecords = pgTable(
  'leave_records',
  {
    id: uuid('id').primaryKey(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staffRecords.id, { onDelete: 'restrict' }),
    leaveTypeId: uuid('leave_type_id')
      .notNull()
      .references(() => leaveTypes.id, { onDelete: 'restrict' }),
    startDate: day('start_date').notNull(),
    endDate: day('end_date').notNull(),
    days: integer('days')
      .notNull()
      .generatedAlwaysAs((): ReturnType<typeof sql> => sql`end_date - start_date + 1`),
    purpose: text('purpose'),
    remarks: text('remarks'),
    ...timestamps,
  },
  (t) => [
    index('leave_records_staff_idx').on(t.staffId, t.startDate),
    check(
      'leave_records_period_ck',
      sql`${t.endDate} >= ${t.startDate} and extract(year from ${t.startDate}) = extract(year from ${t.endDate})`,
    ),
  ],
);
