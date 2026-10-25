import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { RecordType } from '../../../../shared/application/records.js';
import { ConflictError } from '../../../../shared/domain/errors.js';
import { DrizzleRecordStore } from '../../../../shared/infrastructure/persistence/drizzle-record-store.js';
import {
  ALLOWANCE_PAYMENT,
  PAYROLL_MANAGE,
  PAYROLL_READ,
  SALARY_ARREAR,
  SALARY_DEDUCTION,
  SALARY_OVERTIME,
  SALARY_PAYMENT,
  SALARY_PUNISHMENT,
  SALARY_STOP,
} from '../../application/payroll.constants.js';
import { DrizzlePayPeriods } from './drizzle-salary-sheet.repositories.js';
import {
  allowancePayments,
  salaryArrears,
  salaryDeductions,
  salaryOvertimes,
  salaryPayments,
  salaryPunishments,
  salaryStops,
} from './payroll.schema.js';

/** Monthly salary inputs: payroll staff only, and frozen once the month's salary sheet is committed. */
export function monthlyInputRecordTypes(context: DbContext): RecordType[] {
  const periods = new DrizzlePayPeriods(context);
  const openPeriod = async (row: Readonly<Record<string, unknown>>) => {
    if (await periods.isClosed(Number(row['payYear']), Number(row['payMonth']))) {
      throw new ConflictError('pay_period_closed', 'The salary sheet of this month is committed');
    }
  };
  const payroll = { readPermission: PAYROLL_READ, managePermission: PAYROLL_MANAGE };
  const references = (table: string) => ({ [`${table}_staff_id_staff_records_id_fk`]: 'staff' });
  return [
    {
      name: SALARY_OVERTIME,
      ...payroll,
      store: new DrizzleRecordStore(context, salaryOvertimes, {
        name: SALARY_OVERTIME,
        orderBy: [salaryOvertimes.payYear, salaryOvertimes.payMonth, salaryOvertimes.createdAt],
        filters: {
          staffId: salaryOvertimes.staffId,
          payYear: salaryOvertimes.payYear,
          payMonth: salaryOvertimes.payMonth,
        },
        references: references('salary_overtimes'),
        guard: openPeriod,
      }),
    },
    {
      name: SALARY_DEDUCTION,
      ...payroll,
      store: new DrizzleRecordStore(context, salaryDeductions, {
        name: SALARY_DEDUCTION,
        orderBy: [salaryDeductions.payYear, salaryDeductions.payMonth, salaryDeductions.createdAt],
        filters: {
          staffId: salaryDeductions.staffId,
          payYear: salaryDeductions.payYear,
          payMonth: salaryDeductions.payMonth,
        },
        unique: {
          salary_deductions_staff_period_uq: {
            code: 'salary_deduction_exists',
            message: 'This person already has deductions for that month; edit them instead',
          },
        },
        references: references('salary_deductions'),
        guard: openPeriod,
      }),
    },
    {
      name: SALARY_PUNISHMENT,
      ...payroll,
      store: new DrizzleRecordStore(context, salaryPunishments, {
        name: SALARY_PUNISHMENT,
        orderBy: [salaryPunishments.payYear, salaryPunishments.payMonth, salaryPunishments.createdAt],
        filters: {
          staffId: salaryPunishments.staffId,
          payYear: salaryPunishments.payYear,
          payMonth: salaryPunishments.payMonth,
        },
        references: references('salary_punishments'),
        guard: openPeriod,
      }),
    },
    {
      name: SALARY_ARREAR,
      ...payroll,
      store: new DrizzleRecordStore(context, salaryArrears, {
        name: SALARY_ARREAR,
        orderBy: [salaryArrears.payYear, salaryArrears.payMonth, salaryArrears.createdAt],
        filters: {
          staffId: salaryArrears.staffId,
          payYear: salaryArrears.payYear,
          payMonth: salaryArrears.payMonth,
        },
        unique: {
          salary_arrears_staff_period_uq: {
            code: 'salary_arrear_exists',
            message: 'This person already has an arrear for that month; edit it instead',
          },
        },
        references: references('salary_arrears'),
        guard: openPeriod,
      }),
    },
    {
      name: ALLOWANCE_PAYMENT,
      ...payroll,
      store: new DrizzleRecordStore(context, allowancePayments, {
        name: ALLOWANCE_PAYMENT,
        orderBy: [allowancePayments.payYear, allowancePayments.payMonth, allowancePayments.createdAt],
        filters: {
          staffId: allowancePayments.staffId,
          payYear: allowancePayments.payYear,
          payMonth: allowancePayments.payMonth,
        },
        references: references('allowance_payments'),
        guard: openPeriod,
      }),
    },
    {
      // Payments are recorded after the sheet is committed, so they are not frozen.
      name: SALARY_PAYMENT,
      ...payroll,
      store: new DrizzleRecordStore(context, salaryPayments, {
        name: SALARY_PAYMENT,
        orderBy: [salaryPayments.payYear, salaryPayments.payMonth, salaryPayments.createdAt],
        filters: {
          staffId: salaryPayments.staffId,
          payYear: salaryPayments.payYear,
          payMonth: salaryPayments.payMonth,
        },
        references: references('salary_payments'),
      }),
    },
    {
      name: SALARY_STOP,
      ...payroll,
      store: new DrizzleRecordStore(context, salaryStops, {
        name: SALARY_STOP,
        orderBy: [salaryStops.stopYear, salaryStops.stopMonth, salaryStops.createdAt],
        filters: { staffId: salaryStops.staffId },
        references: references('salary_stops'),
      }),
    },
  ];
}
