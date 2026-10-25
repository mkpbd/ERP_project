import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { AccessControl } from '../../../../shared/application/contracts/access-control.js';
import type { StaffDirectory } from '../../../../shared/application/contracts/staff-directory.js';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { DomainError, ForbiddenError, NotFoundError } from '../../../../shared/domain/errors.js';
import type { BonusCalculator } from '../../application/bonus.handlers.js';
import { PAYROLL_READ } from '../../application/payroll.constants.js';
import type { PayrollReadRepository } from '../../application/read-models.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const isoDate = z.iso.date();
const period = { year: z.int().min(2000).max(2100), month: z.int().min(1).max(12) };
const total = (lines: readonly { amount: number }[]) => lines.reduce((sum, line) => sum + line.amount, 0);
const isBank = (mode: string | null) => mode?.trim().toLowerCase() === 'bank';

/** Old festival bonus sheet / FestivalBonusBank|CashStatement: the bonus sheet, all or by payment mode. */
export function festivalBonusReport(read: PayrollReadRepository, calculator: BonusCalculator): ReportDefinition {
  return defineReport({
    key: 'payroll.festival-bonus',
    title: 'Festival bonus sheet',
    group: 'Payroll',
    description: 'A festival bonus with each person’s basic and bonus; optionally only bank or cash payments.',
    params: z.strictObject({ bonusId: z.uuid(), mode: z.enum(['all', 'bank', 'cash']).default('all') }),
    async load(params) {
      const sheet = await read.festivalBonusSheet(params.bonusId);
      if (!sheet) throw new NotFoundError('festival_bonus');
      const all = sheet.status ? sheet.lines : await calculator.bonusLines(sheet.schedule);
      const lines =
        params.mode === 'all' ? all : all.filter((line) => (params.mode === 'bank') === isBank(line.paymentMode));
      return { schedule: sheet.schedule, status: sheet.status, lines, total: total(lines) };
    },
    describe: (params, data) =>
      `${data.schedule.festivalName} · ${MONTHS[data.schedule.payMonth - 1]} ${data.schedule.payYear} · ${data.schedule.percentOfBasic}% of basic` +
      (params.mode === 'all' ? '' : params.mode === 'bank' ? ' · Bank' : ' · Cash'),
    pdf: { engine: 'html', template: template('festival-bonus'), landscape: true },
    xlsx: (data) => ({
      columns: [
        { key: 'employeeNo', header: 'Employee no', width: 12 },
        { key: 'fullName', header: 'Name', width: 26 },
        { key: 'designation', header: 'Designation', width: 20 },
        { key: 'department', header: 'Department', width: 20 },
        { key: 'joiningDate', header: 'Joined', format: 'date' },
        { key: 'paymentMode', header: 'Payment mode', width: 12 },
        { key: 'bankAccountNo', header: 'Bank account', width: 18 },
        { key: 'gross', header: 'Gross', format: 'money' },
        { key: 'basic', header: 'Basic', format: 'money' },
        { key: 'amount', header: 'Bonus', format: 'money' },
      ],
      rows: data.lines.map((line) => ({ ...line })),
    }),
  });
}

/** Old LeaveIncashment print: the month's saved leave encashment. */
export function leaveEncashmentReport(read: PayrollReadRepository): ReportDefinition {
  return defineReport({
    key: 'payroll.leave-encashment',
    title: 'Leave encashment',
    group: 'Payroll',
    description: "The month's saved leave encashment: leave entitled, taken and remaining, and the amount.",
    params: z.strictObject(period),
    async load(params) {
      const lines = await read.leaveEncashments(params.year, params.month);
      return { lines, total: total(lines) };
    },
    describe: (params) => `${MONTHS[params.month - 1]} ${params.year}`,
    pdf: { engine: 'html', template: template('leave-encashment'), landscape: true },
    xlsx: (data) => ({
      columns: [
        { key: 'employeeNo', header: 'Employee no', width: 12 },
        { key: 'fullName', header: 'Name', width: 26 },
        { key: 'department', header: 'Department', width: 20 },
        { key: 'gross', header: 'Gross', format: 'money' },
        { key: 'entitledDays', header: 'Entitled days', format: 'decimal' },
        { key: 'takenDays', header: 'Taken days', format: 'integer' },
        { key: 'remainingDays', header: 'Remaining days', format: 'decimal' },
        { key: 'perDay', header: 'Per day', format: 'money' },
        { key: 'amount', header: 'Amount', format: 'money' },
      ],
      rows: data.lines.map((line) => ({ ...line })),
    }),
  });
}

/** Old SpGetPFMonthlyStatement: PF deducted on a month's saved salary sheet. */
export function pfMonthlyReport(read: PayrollReadRepository): ReportDefinition {
  return defineReport({
    key: 'payroll.pf-monthly',
    title: 'PF deduction statement',
    group: 'Payroll',
    description: "PF deducted from each person on a month's saved salary sheet.",
    params: z.strictObject({ ...period, departmentId: z.uuid().optional() }),
    async load(params) {
      const saved = await read.savedSheet(params.year, params.month);
      if (!saved) throw new NotFoundError('salary_sheet');
      const lines = saved.lines
        .filter((line) => line.pf > 0 && (!params.departmentId || line.departmentId === params.departmentId))
        .sort((a, b) => a.employeeNo.localeCompare(b.employeeNo));
      return { lines, total: lines.reduce((sum, line) => sum + line.pf, 0) };
    },
    describe: (params) => `${MONTHS[params.month - 1]} ${params.year}`,
    pdf: { engine: 'html', template: template('pf-monthly') },
    xlsx: (data) => ({
      columns: [
        { key: 'employeeNo', header: 'Employee no', width: 12 },
        { key: 'fullName', header: 'Name', width: 26 },
        { key: 'designation', header: 'Designation', width: 20 },
        { key: 'department', header: 'Department', width: 20 },
        { key: 'pf', header: 'PF', format: 'money' },
      ],
      rows: data.lines.map((line) => ({ ...line })),
    }),
  });
}

/** Statements of one person's account; people may print their own, others need payroll:read. */
function ledgerReport(
  kind: 'pf' | 'dues',
  read: PayrollReadRepository,
  staff: StaffDirectory,
  access: AccessControl,
): ReportDefinition {
  return defineReport({
    key: kind === 'pf' ? 'payroll.pf-statement' : 'payroll.dues-statement',
    title: kind === 'pf' ? 'PF statement' : 'Staff dues statement',
    group: 'Payroll',
    description:
      kind === 'pf'
        ? 'One person’s PF: deductions from committed salary sheets and ledger entries, with balance.'
        : 'What one person owes service units and has paid back, with balance.',
    params: z.strictObject({ staffId: z.uuid(), from: isoDate, to: isoDate, serviceUnitId: z.uuid().optional() }),
    async load(params, context) {
      if (params.from > params.to) throw new DomainError('invalid_period', 'The start date is after the end date');
      const own = await staff.staffIdForUser(context.actor.userId);
      if (params.staffId !== own && !(await access.isAllowed(context.actor.userId, { permissions: [PAYROLL_READ] }))) {
        throw new ForbiddenError();
      }
      const [person] = await staff.findSummaries([params.staffId]);
      if (!person) throw new NotFoundError('staff');
      const statement =
        kind === 'pf'
          ? await read.pfStatement(params.staffId, params.from, params.to)
          : await read.duesStatement(params.staffId, params.from, params.to, params.serviceUnitId);
      return {
        person,
        statement,
        creditLabel: kind === 'pf' ? 'Credit' : 'Paid',
        debitLabel: kind === 'pf' ? 'Debit' : 'Owed',
      };
    },
    describe: (params) => `${params.from} to ${params.to}`,
    pdf: { engine: 'html', template: template('ledger-statement') },
  });
}

export const pfStatementReport = (read: PayrollReadRepository, staff: StaffDirectory, access: AccessControl) =>
  ledgerReport('pf', read, staff, access);
export const duesStatementReport = (read: PayrollReadRepository, staff: StaffDirectory, access: AccessControl) =>
  ledgerReport('dues', read, staff, access);
