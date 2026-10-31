import { sql, type SQLWrapper } from 'drizzle-orm';
import {
  boolean,
  date,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { serviceUnits } from '../../../administration/infrastructure/persistence/administration.schema.js';
import { festivals, staffRecords } from '../../../hr/infrastructure/persistence/hr.schema.js';
import { users } from '../../../identity/infrastructure/persistence/identity.schema.js';
import type { TaxSlab } from '../../domain/income-tax.js';
import type { SalarySnapshot } from '../../domain/salary.js';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const money = (name: string) => numeric(name, { precision: 12, scale: 2, mode: 'number' });
const percent = (name: string) => numeric(name, { precision: 5, scale: 2, mode: 'number' });
const day = (name: string) => date(name, { mode: 'string' });
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

const payPeriod = {
  payYear: smallint('pay_year').notNull(),
  payMonth: smallint('pay_month').notNull(),
};
const payPeriodCheck = (name: string, t: { payYear: SQLWrapper; payMonth: SQLWrapper }) =>
  check(`${name}_period_ck`, sql`${t.payYear} between 2000 and 2100 and ${t.payMonth} between 1 and 12`);
const staffRef = () =>
  uuid('staff_id')
    .notNull()
    .references(() => staffRecords.id, { onDelete: 'restrict' });

// Old Payroll.StaffOvertimes: hours (paid at gross ÷ (days × 8)) and/or a fixed amount, in a pay month.
export const salaryOvertimes = pgTable(
  'salary_overtimes',
  {
    id: uuid('id').primaryKey(),
    staffId: staffRef(),
    workYear: smallint('work_year').notNull(),
    workMonth: smallint('work_month').notNull(),
    ...payPeriod,
    days: integer('days').notNull().default(0),
    hours: integer('hours').notNull().default(0),
    amount: money('amount').notNull().default(0),
    remarks: text('remarks'),
    ...timestamps,
  },
  (t) => [
    index('salary_overtimes_period_idx').on(t.payYear, t.payMonth, t.staffId),
    payPeriodCheck('salary_overtimes', t),
    check('salary_overtimes_work_ck', sql`${t.workYear} between 2000 and 2100 and ${t.workMonth} between 1 and 12`),
    check(
      'salary_overtimes_amounts_ck',
      sql`${t.days} between 0 and 31 and ${t.hours} between 0 and 744 and ${t.amount} >= 0
        and (${t.hours} > 0 or ${t.amount} > 0)`,
    ),
  ],
);

// Old Payroll.StaffSalaryDeductions, one per person and pay month. The old salary sheet used only the LWP days
// and the other deduction; AIT, SM, mobile and food bills, loan and advance are kept as entered.
export const salaryDeductions = pgTable(
  'salary_deductions',
  {
    id: uuid('id').primaryKey(),
    staffId: staffRef(),
    ...payPeriod,
    lwpDays: numeric('lwp_days', { precision: 5, scale: 2, mode: 'number' }).notNull().default(0),
    lwpFrom: day('lwp_from'),
    lwpTo: day('lwp_to'),
    otherDeduction: money('other_deduction').notNull().default(0),
    ait: money('ait').notNull().default(0),
    sm: money('sm').notNull().default(0),
    mobileBill: money('mobile_bill').notNull().default(0),
    foodBill: money('food_bill').notNull().default(0),
    loan: money('loan').notNull().default(0),
    advanceSalary: money('advance_salary').notNull().default(0),
    cause: text('cause').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('salary_deductions_staff_period_uq').on(t.staffId, t.payYear, t.payMonth),
    payPeriodCheck('salary_deductions', t),
    check(
      'salary_deductions_amounts_ck',
      sql`${t.lwpDays} between 0 and 31 and ${t.otherDeduction} >= 0 and ${t.ait} >= 0 and ${t.sm} >= 0
        and ${t.mobileBill} >= 0 and ${t.foodBill} >= 0 and ${t.loan} >= 0 and ${t.advanceSalary} >= 0`,
    ),
    check(
      'salary_deductions_lwp_dates_ck',
      sql`${t.lwpDays} = 0 or (${t.lwpFrom} is not null and ${t.lwpTo} is not null and ${t.lwpTo} >= ${t.lwpFrom})`,
    ),
    check('salary_deductions_cause_len_ck', sql`char_length(${t.cause}) between 1 and 500`),
  ],
);

// Old Payroll.SalaryPunishments.
export const salaryPunishments = pgTable(
  'salary_punishments',
  {
    id: uuid('id').primaryKey(),
    staffId: staffRef(),
    ...payPeriod,
    amount: money('amount').notNull(),
    description: text('description').notNull(),
    ...timestamps,
  },
  (t) => [
    index('salary_punishments_period_idx').on(t.payYear, t.payMonth, t.staffId),
    payPeriodCheck('salary_punishments', t),
    check('salary_punishments_amount_ck', sql`${t.amount} > 0`),
    check('salary_punishments_description_len_ck', sql`char_length(${t.description}) between 1 and 500`),
  ],
);

// Old Payroll.ArrearRecords: one per person and pay month (the old duplicate check).
export const salaryArrears = pgTable(
  'salary_arrears',
  {
    id: uuid('id').primaryKey(),
    staffId: staffRef(),
    ...payPeriod,
    amount: money('amount').notNull(),
    remarks: text('remarks'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('salary_arrears_staff_period_uq').on(t.staffId, t.payYear, t.payMonth),
    payPeriodCheck('salary_arrears', t),
    check('salary_arrears_amount_ck', sql`${t.amount} > 0`),
  ],
);

// Old Payroll.AllowancePayments: extra allowances paid with a month's salary; the refund is kept as entered.
export const allowancePayments = pgTable(
  'allowance_payments',
  {
    id: uuid('id').primaryKey(),
    staffId: staffRef(),
    ...payPeriod,
    otherAllowance: money('other_allowance').notNull().default(0),
    specialAllowance: money('special_allowance').notNull().default(0),
    salaryRefund: money('salary_refund').notNull().default(0),
    refundComment: text('refund_comment'),
    paidOn: day('paid_on'),
    ...timestamps,
  },
  (t) => [
    index('allowance_payments_period_idx').on(t.payYear, t.payMonth, t.staffId),
    payPeriodCheck('allowance_payments', t),
    check(
      'allowance_payments_amounts_ck',
      sql`${t.otherAllowance} >= 0 and ${t.specialAllowance} >= 0 and ${t.salaryRefund} >= 0`,
    ),
  ],
);

// Old Payroll.StaffMonthlySalaryRecords: what was actually paid (shown on the sheet, not subtracted).
export const salaryPayments = pgTable(
  'salary_payments',
  {
    id: uuid('id').primaryKey(),
    staffId: staffRef(),
    ...payPeriod,
    paidOn: day('paid_on'),
    advancePaid: money('advance_paid').notNull().default(0),
    salaryPaid: money('salary_paid').notNull().default(0),
    paymentMode: text('payment_mode').notNull(),
    ...timestamps,
  },
  (t) => [
    index('salary_payments_period_idx').on(t.payYear, t.payMonth, t.staffId),
    payPeriodCheck('salary_payments', t),
    check('salary_payments_amounts_ck', sql`${t.advancePaid} >= 0 and ${t.salaryPaid} >= 0`),
    check('salary_payments_mode_len_ck', sql`char_length(${t.paymentMode}) between 1 and 50`),
  ],
);

// Old Payroll.SalaryStartStopRecords: a log of salary held back and released (not used by the sheet).
export const salaryStops = pgTable(
  'salary_stops',
  {
    id: uuid('id').primaryKey(),
    staffId: staffRef(),
    stopYear: smallint('stop_year').notNull(),
    stopMonth: smallint('stop_month').notNull(),
    startYear: smallint('start_year'),
    startMonth: smallint('start_month'),
    stoppedAmount: money('stopped_amount').notNull().default(0),
    remarks: text('remarks'),
    ...timestamps,
  },
  (t) => [
    index('salary_stops_staff_idx').on(t.staffId),
    check('salary_stops_stop_ck', sql`${t.stopYear} between 2000 and 2100 and ${t.stopMonth} between 1 and 12`),
    check(
      'salary_stops_start_ck',
      sql`(${t.startYear} is null and ${t.startMonth} is null) or (${t.startMonth} between 1 and 12
        and ${t.startYear} * 12 + ${t.startMonth} >= ${t.stopYear} * 12 + ${t.stopMonth})`,
    ),
    check('salary_stops_amount_ck', sql`${t.stoppedAmount} >= 0`),
  ],
);

// Old Payroll.MonthlyHrSalarySheet (scratch) + ApprovedSalarySheets: one approved sheet per pay month.
export const salarySheets = pgTable(
  'salary_sheets',
  {
    id: uuid('id').primaryKey(),
    year: smallint('year').notNull(),
    month: smallint('month').notNull(),
    status: text('status', { enum: ['approved', 'committed'] }).notNull(),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: tz('approved_at').notNull(),
    committedBy: uuid('committed_by').references(() => users.id, { onDelete: 'set null' }),
    committedAt: tz('committed_at'),
  },
  (t) => [
    uniqueIndex('salary_sheets_period_uq').on(t.year, t.month),
    check('salary_sheets_period_ck', sql`${t.year} between 2000 and 2100 and ${t.month} between 1 and 12`),
    check('salary_sheets_status_ck', sql`${t.status} in ('approved', 'committed')`),
  ],
);

// One person's approved salary, with their details as they were (old ApprovedSalarySheets rows).
export const salarySheetLines = pgTable(
  'salary_sheet_lines',
  {
    sheetId: uuid('sheet_id')
      .notNull()
      .references(() => salarySheets.id, { onDelete: 'cascade' }),
    staffId: staffRef(),
    employeeNo: text('employee_no').notNull(),
    fullName: text('full_name').notNull(),
    departmentId: uuid('department_id').notNull(),
    department: text('department').notNull(),
    designation: text('designation').notNull(),
    joiningDate: day('joining_date').notNull(),
    paymentMode: text('payment_mode'),
    bankAccountNo: text('bank_account_no'),
    basic: money('basic').notNull(),
    houseRent: money('house_rent').notNull(),
    medical: money('medical').notNull(),
    conveyance: money('conveyance').notNull(),
    otherAllowance: money('other_allowance').notNull(),
    gross: money('gross').notNull(),
    allowance: money('allowance').notNull(),
    specialAllowance: money('special_allowance').notNull(),
    overtime: money('overtime').notNull(),
    festivalBonus: money('festival_bonus').notNull(),
    arrear: money('arrear').notNull(),
    totalPayable: money('total_payable').notNull(),
    pf: money('pf').notNull(),
    incomeTax: money('income_tax').notNull(),
    lwpDays: numeric('lwp_days', { precision: 5, scale: 2, mode: 'number' }).notNull(),
    lwp: money('lwp').notNull(),
    punishment: money('punishment').notNull(),
    totalDeduction: money('total_deduction').notNull(),
    netPayable: money('net_payable').notNull(),
    advance: money('advance').notNull(),
    paid: money('paid').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sheetId, t.staffId] }),
    index('salary_sheet_lines_staff_idx').on(t.staffId),
    check('salary_sheet_lines_net_ck', sql`${t.netPayable} >= 0`),
  ],
);

// Old Payroll.FestivalBonuses: a festival's bonus in a pay month, as a percentage of basic. The joining
// cut-off was a screen parameter (BeforeJoiningDate); paying with salary chooses between the old salary
// sheet's bonus column and the separate bonus sheet.
export const festivalBonuses = pgTable(
  'festival_bonuses',
  {
    id: uuid('id').primaryKey(),
    festivalId: uuid('festival_id')
      .notNull()
      .references(() => festivals.id, { onDelete: 'restrict' }),
    ...payPeriod,
    percentOfBasic: percent('percent_of_basic').notNull(),
    joinedBy: day('joined_by').notNull(),
    payWithSalary: boolean('pay_with_salary').notNull().default(false),
    dateFrom: day('date_from'),
    dateTo: day('date_to'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('festival_bonuses_festival_period_uq').on(t.festivalId, t.payYear, t.payMonth),
    payPeriodCheck('festival_bonuses', t),
    check('festival_bonuses_percent_ck', sql`${t.percentOfBasic} > 0 and ${t.percentOfBasic} <= 100`),
    check(
      'festival_bonuses_dates_ck',
      sql`${t.dateTo} is null or ${t.dateFrom} is null or ${t.dateTo} >= ${t.dateFrom}`,
    ),
  ],
);

// Old Payroll.AprovedFestivalBonuses: the approved bonus sheet of one festival bonus.
export const festivalBonusLines = pgTable(
  'festival_bonus_lines',
  {
    bonusId: uuid('bonus_id')
      .notNull()
      .references(() => festivalBonuses.id, { onDelete: 'restrict' }),
    staffId: staffRef(),
    employeeNo: text('employee_no').notNull(),
    fullName: text('full_name').notNull(),
    departmentId: uuid('department_id').notNull(),
    department: text('department').notNull(),
    designation: text('designation').notNull(),
    joiningDate: day('joining_date').notNull(),
    paymentMode: text('payment_mode'),
    bankAccountNo: text('bank_account_no'),
    gross: money('gross').notNull(),
    basic: money('basic').notNull(),
    amount: money('amount').notNull(),
    status: text('status', { enum: ['approved', 'committed'] }).notNull(),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: tz('approved_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.bonusId, t.staffId] }),
    index('festival_bonus_lines_staff_idx').on(t.staffId),
    check('festival_bonus_lines_amount_ck', sql`${t.amount} >= 0`),
    check('festival_bonus_lines_status_ck', sql`${t.status} in ('approved', 'committed')`),
  ],
);

// Old Payroll.LeaveEncashments (+ procedure LeaveIncashment): unused leave paid out, saved per pay month.
export const leaveEncashments = pgTable(
  'leave_encashments',
  {
    staffId: staffRef(),
    ...payPeriod,
    leaveYear: smallint('leave_year').notNull(),
    employeeNo: text('employee_no').notNull(),
    fullName: text('full_name').notNull(),
    departmentId: uuid('department_id').notNull(),
    department: text('department').notNull(),
    designation: text('designation').notNull(),
    joiningDate: day('joining_date').notNull(),
    paymentMode: text('payment_mode'),
    gross: money('gross').notNull(),
    entitledDays: numeric('entitled_days', { precision: 5, scale: 2, mode: 'number' }).notNull(),
    takenDays: integer('taken_days').notNull(),
    remainingDays: numeric('remaining_days', { precision: 5, scale: 2, mode: 'number' }).notNull(),
    perDay: money('per_day').notNull(),
    amount: money('amount').notNull(),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: tz('approved_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.staffId, t.payYear, t.payMonth] }),
    payPeriodCheck('leave_encashments', t),
    check('leave_encashments_amount_ck', sql`${t.amount} > 0 and ${t.remainingDays} > 0`),
  ],
);

// Old Payroll.PFLedgers: entries outside the salary sheet (opening balance, interest, withdrawal, settlement).
// The running balance is worked out, not stored.
export const pfLedgerEntries = pgTable(
  'pf_ledger_entries',
  {
    id: uuid('id').primaryKey(),
    staffId: staffRef(),
    entryDate: day('entry_date').notNull(),
    type: text('type', {
      enum: ['opening', 'contribution', 'interest', 'withdrawal', 'settlement', 'adjustment'],
    }).notNull(),
    credit: money('credit').notNull().default(0),
    debit: money('debit').notNull().default(0),
    remarks: text('remarks'),
    ...timestamps,
  },
  (t) => [
    index('pf_ledger_entries_staff_idx').on(t.staffId, t.entryDate),
    check(
      'pf_ledger_entries_type_ck',
      sql`${t.type} in ('opening', 'contribution', 'interest', 'withdrawal', 'settlement', 'adjustment')`,
    ),
    check(
      'pf_ledger_entries_amount_ck',
      sql`${t.credit} >= 0 and ${t.debit} >= 0 and (${t.credit} > 0) <> (${t.debit} > 0)`,
    ),
  ],
);

// Old Payroll.StaffGlobalLedgers: what staff owe a service unit (e.g. canteen or pharmacy on credit) and
// what they paid back. The running balance is worked out, not stored.
export const staffDues = pgTable(
  'staff_dues',
  {
    id: uuid('id').primaryKey(),
    staffId: staffRef(),
    serviceUnitId: uuid('service_unit_id').references(() => serviceUnits.id, { onDelete: 'restrict' }),
    entryDate: day('entry_date').notNull(),
    particulars: text('particulars').notNull(),
    debit: money('debit').notNull().default(0),
    credit: money('credit').notNull().default(0),
    reference: text('reference'),
    ...timestamps,
  },
  (t) => [
    index('staff_dues_staff_idx').on(t.staffId, t.entryDate),
    check('staff_dues_particulars_len_ck', sql`char_length(${t.particulars}) between 1 and 300`),
    check('staff_dues_amount_ck', sql`${t.debit} >= 0 and ${t.credit} >= 0 and (${t.debit} > 0) <> (${t.credit} > 0)`),
  ],
);

// Old Payroll.TaxSlabs (rows per gender and SlabStartEndDate such as '2025-2026', an 'Exempted' row) and the
// constants hard-coded in the income tax procedures, kept per tax year.
export const incomeTaxYears = pgTable(
  'income_tax_years',
  {
    id: uuid('id').primaryKey(),
    label: text('label').notNull(),
    startsOn: day('starts_on').notNull(),
    endsOn: day('ends_on').notNull(),
    maleSlabs: jsonb('male_slabs').$type<TaxSlab[]>().notNull(),
    femaleSlabs: jsonb('female_slabs').$type<TaxSlab[]>().notNull(),
    maleExemptionCap: money('male_exemption_cap').notNull(),
    femaleExemptionCap: money('female_exemption_cap').notNull(),
    rebateOnTaxablePercent: percent('rebate_on_taxable_percent').notNull().default(3),
    investmentAllowancePercent: percent('investment_allowance_percent').notNull().default(20),
    rebateOnInvestmentPercent: percent('rebate_on_investment_percent').notNull().default(15),
    rebateCap: money('rebate_cap').notNull().default(1000000),
    minimumMonthlyTax: money('minimum_monthly_tax').notNull().default(417),
    maleMinimumTaxGross: money('male_minimum_tax_gross').notNull(),
    femaleMinimumTaxGross: money('female_minimum_tax_gross').notNull(),
    expectedBonusBasics: numeric('expected_bonus_basics', { precision: 4, scale: 2, mode: 'number' })
      .notNull()
      .default(2.5),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('income_tax_years_label_uq').on(t.label),
    uniqueIndex('income_tax_years_start_uq').on(t.startsOn),
    check('income_tax_years_dates_ck', sql`${t.endsOn} > ${t.startsOn}`),
    check('income_tax_years_label_len_ck', sql`char_length(${t.label}) between 1 and 20`),
  ],
);

// Old Payroll.IndividualSalariesIncomeTax: the tax to deduct from a person's salary in a pay month, worked out
// from the tax year so far or entered by hand (the old TaxAdjustmentListOfMay overrides).
export const incomeTaxDeductions = pgTable(
  'income_tax_deductions',
  {
    staffId: staffRef(),
    ...payPeriod,
    taxYearId: uuid('tax_year_id')
      .notNull()
      .references(() => incomeTaxYears.id, { onDelete: 'restrict' }),
    // Empty for a deduction entered by hand.
    taxableIncome: money('taxable_income'),
    yearlyTax: money('yearly_tax'),
    monthlyTax: money('monthly_tax').notNull(),
    source: text('source', { enum: ['computed', 'manual'] }).notNull(),
    remarks: text('remarks'),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: tz('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.staffId, t.payYear, t.payMonth] }),
    payPeriodCheck('income_tax_deductions', t),
    check('income_tax_deductions_amount_ck', sql`${t.monthlyTax} >= 0`),
    check('income_tax_deductions_source_ck', sql`${t.source} in ('computed', 'manual')`),
  ],
);

// Old Payroll.EmployeeTaxChallans: the treasury challan the tax deducted from a person's salary in a pay month was
// deposited with (one a month, as the old grid had).
export const taxChallans = pgTable(
  'payroll_tax_challans',
  {
    id: uuid('id').primaryKey(),
    staffId: staffRef(),
    ...payPeriod,
    challanNo: text('challan_no').notNull(),
    challanDate: day('challan_date').notNull(),
    /** Where it was deposited (the old entry had no bank). */
    bank: text('bank'),
    amount: money('amount').notNull(),
    note: text('note'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('payroll_tax_challans_month_uq').on(t.staffId, t.payYear, t.payMonth),
    index('payroll_tax_challans_period_idx').on(t.payYear, t.payMonth),
    payPeriodCheck('payroll_tax_challans', t),
    check('payroll_tax_challans_amount_ck', sql`${t.amount} > 0`),
    check('payroll_tax_challans_no_ck', sql`char_length(${t.challanNo}) between 1 and 50`),
  ],
);
