import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { staffRecords } from '../../../hr/infrastructure/persistence/hr.schema.js';
import { users } from '../../../identity/infrastructure/persistence/identity.schema.js';
import type { SalarySnapshot } from '../../domain/salary.js';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const money = (name: string) => numeric(name, { precision: 12, scale: 2, mode: 'number' });
const percent = (name: string) => numeric(name, { precision: 5, scale: 2, mode: 'number' });
const timestamps = {
  createdAt: tz('created_at').notNull().defaultNow(),
  updatedAt: tz('updated_at').notNull().defaultNow(),
};

// Old Payroll.GeneralSalaryPolicies; the conveyance cap was hard-coded (2,500) in the old screens.
export const salaryPolicies = pgTable(
  'salary_policies',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    basicPercentOfGross: percent('basic_percent_of_gross').notNull(),
    houseRentPercentOfBasic: percent('house_rent_percent_of_basic').notNull(),
    medicalPercentOfBasic: percent('medical_percent_of_basic').notNull(),
    pfPercentOfBasic: percent('pf_percent_of_basic').notNull().default(0),
    cpfPercentOfBasic: percent('cpf_percent_of_basic').notNull().default(0),
    conveyanceCap: money('conveyance_cap').notNull().default(2500),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('salary_policies_name_uq').on(sql`lower(${t.name})`),
    check('salary_policies_name_len_ck', sql`char_length(${t.name}) between 1 and 100`),
    check(
      'salary_policies_percent_ck',
      sql`${t.basicPercentOfGross} between 0 and 100 and ${t.houseRentPercentOfBasic} between 0 and 100
        and ${t.medicalPercentOfBasic} between 0 and 100 and ${t.pfPercentOfBasic} between 0 and 100
        and ${t.cpfPercentOfBasic} between 0 and 100`,
    ),
    check('salary_policies_cap_ck', sql`${t.conveyanceCap} >= 0`),
  ],
);

// Old Payroll.SalaryEvaluationDurations: a label only (e.g. "Yearly").
export const salaryReviewCycles = pgTable(
  'salary_review_cycles',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('salary_review_cycles_name_uq').on(sql`lower(${t.name})`),
    check('salary_review_cycles_name_len_ck', sql`char_length(${t.name}) between 1 and 100`),
  ],
);

// Old Payroll.IndividualSalaries (HouseRentInPercentOfBasic / MedicalAllownceInPercentOfBasic held amounts).
export const staffSalaries = pgTable(
  'staff_salaries',
  {
    staffId: uuid('staff_id')
      .primaryKey()
      .references(() => staffRecords.id, { onDelete: 'restrict' }),
    policyId: uuid('policy_id')
      .notNull()
      .references(() => salaryPolicies.id, { onDelete: 'restrict' }),
    gross: money('gross').notNull(),
    basic: money('basic').notNull(),
    houseRent: money('house_rent').notNull(),
    medical: money('medical').notNull(),
    conveyance: money('conveyance').notNull(),
    otherAllowance: money('other_allowance').notNull(),
    pf: money('pf').notNull(),
    cpf: money('cpf').notNull(),
    pfEnabled: boolean('pf_enabled').notNull(),
    specialAllowance: money('special_allowance').notNull().default(0),
    otherFixed: money('other_fixed').notNull().default(0),
    overtimeRatePerHour: money('overtime_rate_per_hour').notNull().default(0),
    taxableAmount: money('taxable_amount').notNull().default(0),
    incrementMethod: text('increment_method', { enum: ['percentage', 'fixed', 'individual'] }).notNull(),
    incrementPercent: percent('increment_percent').notNull().default(10),
    fixedIncrement: money('fixed_increment').notNull().default(0),
    reviewCycleId: uuid('review_cycle_id').references(() => salaryReviewCycles.id, { onDelete: 'restrict' }),
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (t) => [
    index('staff_salaries_policy_idx').on(t.policyId),
    check('staff_salaries_gross_ck', sql`${t.gross} > 0`),
    check(
      'staff_salaries_amounts_ck',
      sql`${t.basic} >= 0 and ${t.houseRent} >= 0 and ${t.medical} >= 0 and ${t.conveyance} >= 0
        and ${t.otherAllowance} >= 0 and ${t.pf} >= 0 and ${t.cpf} >= 0 and ${t.specialAllowance} >= 0
        and ${t.otherFixed} >= 0 and ${t.overtimeRatePerHour} >= 0 and ${t.taxableAmount} >= 0
        and ${t.fixedIncrement} >= 0`,
    ),
    check('staff_salaries_increment_method_ck', sql`${t.incrementMethod} in ('percentage', 'fixed', 'individual')`),
    check('staff_salaries_increment_percent_ck', sql`${t.incrementPercent} between 0 and 100`),
  ],
);

// Old Payroll.IncrementRecords, with the salary before the increment so it can be undone exactly.
export const salaryIncrements = pgTable(
  'salary_increments',
  {
    id: uuid('id').primaryKey(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staffRecords.id, { onDelete: 'restrict' }),
    year: smallint('year').notNull(),
    month: smallint('month').notNull(),
    method: text('method', { enum: ['percentage', 'fixed', 'individual'] }).notNull(),
    amount: money('amount').notNull(),
    arrear: money('arrear').notNull().default(0),
    before: jsonb('before').$type<SalarySnapshot>().notNull(),
    salaryVersion: integer('salary_version').notNull(),
    status: text('status', { enum: ['pending', 'committed'] })
      .notNull()
      .default('pending'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: tz('created_at').notNull().defaultNow(),
    committedBy: uuid('committed_by').references(() => users.id, { onDelete: 'set null' }),
    committedAt: tz('committed_at'),
  },
  (t) => [
    uniqueIndex('salary_increments_staff_period_uq').on(t.staffId, t.year, t.month),
    index('salary_increments_period_idx').on(t.year, t.month, t.status),
    check('salary_increments_period_ck', sql`${t.year} between 2000 and 2100 and ${t.month} between 1 and 12`),
    check('salary_increments_amounts_ck', sql`${t.amount} > 0 and ${t.arrear} >= 0`),
    check('salary_increments_status_ck', sql`${t.status} in ('pending', 'committed')`),
  ],
);
