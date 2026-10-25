import { sql } from 'drizzle-orm';
import { check, date, index, pgTable, primaryKey, text, time, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from '../../../identity/infrastructure/persistence/identity.schema.js';
import { hrDepartments, hrSubDepartments, staffRecords } from './hr.schema.js';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const day = (name: string) => date(name, { mode: 'string' });
const timestamps = {
  createdAt: tz('created_at').notNull().defaultNow(),
  updatedAt: tz('updated_at').notNull().defaultNow(),
};

// Old HR.RoasterType: a department's shift with local start/end times (end before start = overnight).
export const shiftTypes = pgTable(
  'shift_types',
  {
    id: uuid('id').primaryKey(),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => hrDepartments.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('shift_types_department_code_uq').on(t.departmentId, sql`upper(${t.code})`),
    check('shift_types_times_ck', sql`${t.startTime} <> ${t.endTime}`),
    check('shift_types_code_len_ck', sql`char_length(${t.code}) between 1 and 10`),
  ],
);

// Old HR.DutyRoasterCalender + DutyRoasterCalenderDetail (EmployeeIds lists split into one row per person).
export const rosterDuties = pgTable(
  'roster_duties',
  {
    id: uuid('id').primaryKey(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staffRecords.id, { onDelete: 'cascade' }),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => hrDepartments.id, { onDelete: 'restrict' }),
    subDepartmentId: uuid('sub_department_id')
      .notNull()
      .references(() => hrSubDepartments.id, { onDelete: 'restrict' }),
    dutyDate: day('duty_date').notNull(),
    shiftTypeId: uuid('shift_type_id')
      .notNull()
      .references(() => shiftTypes.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    startAt: tz('start_at').notNull(),
    endAt: tz('end_at').notNull(),
    remarks: text('remarks'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('roster_duties_staff_date_shift_uq').on(t.staffId, t.dutyDate, t.shiftTypeId),
    index('roster_duties_scope_idx').on(t.departmentId, t.subDepartmentId, t.dutyDate),
    index('roster_duties_staff_start_idx').on(t.staffId, t.startAt),
    check('roster_duties_interval_ck', sql`${t.endAt} > ${t.startAt}`),
  ],
);

// Old EMR.Holidays: a person's day off in the roster.
export const staffDaysOff = pgTable(
  'staff_days_off',
  {
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staffRecords.id, { onDelete: 'cascade' }),
    offDate: day('off_date').notNull(),
    remarks: text('remarks'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: 'staff_days_off_pk', columns: [t.staffId, t.offDate] })],
);

// Old HR.DutyExchangeRecords: a log of swapped duties (the roster itself is edited separately).
export const dutyExchanges = pgTable(
  'duty_exchanges',
  {
    id: uuid('id').primaryKey(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staffRecords.id, { onDelete: 'restrict' }),
    exchangeWithStaffId: uuid('exchange_with_staff_id')
      .notNull()
      .references(() => staffRecords.id, { onDelete: 'restrict' }),
    dateFrom: day('date_from').notNull(),
    dateTo: day('date_to').notNull(),
    shift: text('shift'),
    remarks: text('remarks'),
    ...timestamps,
  },
  (t) => [
    index('duty_exchanges_staff_idx').on(t.staffId, t.dateFrom),
    check('duty_exchanges_dates_ck', sql`${t.dateTo} >= ${t.dateFrom}`),
    check('duty_exchanges_not_self_ck', sql`${t.staffId} <> ${t.exchangeWithStaffId}`),
  ],
);

// Old HR.OverManageDutyRecords: extra days worked and the days off given in return.
export const extraDuties = pgTable(
  'extra_duties',
  {
    id: uuid('id').primaryKey(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staffRecords.id, { onDelete: 'restrict' }),
    dutyFrom: day('duty_from').notNull(),
    dutyTo: day('duty_to').notNull(),
    compensationFrom: day('compensation_from'),
    compensationTo: day('compensation_to'),
    remarks: text('remarks'),
    ...timestamps,
  },
  (t) => [
    index('extra_duties_staff_idx').on(t.staffId, t.dutyFrom),
    check('extra_duties_dates_ck', sql`${t.dutyTo} >= ${t.dutyFrom}`),
    check(
      'extra_duties_compensation_ck',
      sql`(${t.compensationFrom} is null and ${t.compensationTo} is null) or ${t.compensationTo} >= ${t.compensationFrom}`,
    ),
  ],
);
