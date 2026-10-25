import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { AccessControl } from '../../../../shared/application/contracts/access-control.js';
import type { StaffDirectory } from '../../../../shared/application/contracts/staff-directory.js';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { ForbiddenError, NotFoundError } from '../../../../shared/domain/errors.js';
import { PAYROLL_READ } from '../../application/payroll.constants.js';
import type { PayrollReadRepository } from '../../application/read-models.js';
import type { SalarySheetBuilder } from '../../application/salary-sheet.handlers.js';
import type { SalarySheetLine } from '../../domain/repositories.js';

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
const AMOUNTS = [
  'basic',
  'houseRent',
  'medical',
  'conveyance',
  'otherAllowance',
  'gross',
  'allowance',
  'specialAllowance',
  'overtime',
  'festivalBonus',
  'arrear',
  'totalPayable',
  'pf',
  'incomeTax',
  'lwp',
  'punishment',
  'totalDeduction',
  'netPayable',
  'advance',
  'paid',
] as const;
type Totals = Record<(typeof AMOUNTS)[number], number>;
const LABELS: Record<(typeof AMOUNTS)[number], string> = {
  basic: 'Basic',
  houseRent: 'House rent',
  medical: 'Medical',
  conveyance: 'Conveyance',
  otherAllowance: 'Other allowance',
  gross: 'Gross',
  allowance: 'Allowance paid',
  specialAllowance: 'Special allowance',
  overtime: 'Overtime',
  festivalBonus: 'Festival bonus',
  arrear: 'Arrear',
  totalPayable: 'Total payable',
  pf: 'PF',
  incomeTax: 'Income tax',
  lwp: 'LWP',
  punishment: 'Punishment',
  totalDeduction: 'Total deduction',
  netPayable: 'Net payable',
  advance: 'Advance',
  paid: 'Paid',
};

const totalsOf = (lines: readonly SalarySheetLine[]): Totals =>
  Object.fromEntries(AMOUNTS.map((key) => [key, lines.reduce((sum, line) => sum + line[key], 0)])) as Totals;

function groupByDepartment(lines: readonly SalarySheetLine[]) {
  const groups: { department: string; lines: SalarySheetLine[] }[] = [];
  for (const line of lines) {
    const last = groups.at(-1);
    if (last && last.department === line.department) last.lines.push(line);
    else groups.push({ department: line.department, lines: [line] });
  }
  return groups.map((group) => ({ ...group, totals: totalsOf(group.lines) }));
}

const period = { year: z.int().min(2000).max(2100), month: z.int().min(1).max(12) };
const describePeriod = (params: { year: number; month: number }) => `${MONTHS[params.month - 1]} ${params.year}`;

async function approvedLines(read: PayrollReadRepository, year: number, month: number) {
  const saved = await read.savedSheet(year, month);
  if (!saved) throw new NotFoundError('salary_sheet');
  return saved.lines;
}

const lineColumns = [
  { key: 'employeeNo', header: 'Employee no', width: 12 },
  { key: 'fullName', header: 'Name', width: 26 },
  { key: 'department', header: 'Department', width: 20 },
  { key: 'designation', header: 'Designation', width: 20 },
  { key: 'joiningDate', header: 'Joined', format: 'date' as const },
  { key: 'paymentMode', header: 'Payment mode', width: 12 },
  { key: 'bankAccountNo', header: 'Bank account', width: 18 },
  { key: 'lwpDays', header: 'LWP days', format: 'decimal' as const },
  ...AMOUNTS.map((key) => ({ key, header: LABELS[key], format: 'money' as const })),
];

/** Old spGetHrSalarySheet print: the approved sheet, or a draft worked out now when not yet approved. */
export function salarySheetReport(read: PayrollReadRepository, builder: SalarySheetBuilder): ReportDefinition {
  return defineReport({
    key: 'payroll.salary-sheet',
    title: 'Salary sheet',
    group: 'Payroll',
    description: 'Everyone’s salary for a month by department, with totals. Drafts are marked until approved.',
    params: z.strictObject({ ...period, departmentId: z.uuid().optional() }),
    async load(params) {
      const saved = await read.savedSheet(params.year, params.month);
      const all = saved ? saved.lines : await builder.lines(params.year, params.month);
      const lines = params.departmentId ? all.filter((line) => line.departmentId === params.departmentId) : all;
      return {
        status: saved?.status ?? null,
        lines,
        groups: groupByDepartment(lines),
        totals: totalsOf(lines),
        count: lines.length,
      };
    },
    describe: (params, data) =>
      `${describePeriod(params)} · ${data.status === 'committed' ? 'Committed' : data.status === 'approved' ? 'Approved' : 'Draft'}`,
    pdf: { engine: 'html', template: template('salary-sheet'), landscape: true, pageSize: 'Legal' },
    xlsx: (data) => ({ columns: lineColumns, rows: data.lines.map((line) => ({ ...line })) }),
  });
}

/** Old SpGetSalaryPaySlip: one person's approved salary. Staff can print their own. */
export function payslipReport(
  read: PayrollReadRepository,
  staff: StaffDirectory,
  access: AccessControl,
): ReportDefinition {
  return defineReport({
    key: 'payroll.payslip',
    title: 'Payslip',
    group: 'Payroll',
    description: "One person's salary for a month: earnings, deductions and net payable.",
    params: z.strictObject({ ...period, staffId: z.uuid() }),
    async load(params, context) {
      const own = await staff.staffIdForUser(context.actor.userId);
      if (params.staffId !== own && !(await access.isAllowed(context.actor.userId, { permissions: [PAYROLL_READ] }))) {
        throw new ForbiddenError();
      }
      const line = await read.sheetLine(params.year, params.month, params.staffId);
      if (!line) throw new NotFoundError('payslip');
      return line;
    },
    describe: (params, data) => `${describePeriod(params)} · ${data.employeeNo} ${data.fullName}`,
    pdf: { engine: 'html', template: template('payslip') },
  });
}

/** Old SpGetBanksalaryStatement / SpGetCashsalaryStatement: net pay of the approved sheet by payment mode. */
export function salaryStatementReport(read: PayrollReadRepository): ReportDefinition {
  return defineReport({
    key: 'payroll.salary-statement',
    title: 'Salary payment statement',
    group: 'Payroll',
    description: 'Net pay of the approved sheet for bank transfer (with account numbers) or cash payment.',
    params: z.strictObject({ ...period, mode: z.enum(['bank', 'cash']), departmentId: z.uuid().optional() }),
    async load(params) {
      const isBank = (line: SalarySheetLine) => line.paymentMode?.trim().toLowerCase() === 'bank';
      const lines = (await approvedLines(read, params.year, params.month))
        .filter((line) => (params.mode === 'bank' ? isBank(line) : !isBank(line)))
        .filter((line) => !params.departmentId || line.departmentId === params.departmentId)
        .sort((a, b) => a.employeeNo.localeCompare(b.employeeNo));
      return { lines, bank: params.mode === 'bank', total: lines.reduce((sum, line) => sum + line.netPayable, 0) };
    },
    describe: (params) => `${describePeriod(params)} · ${params.mode === 'bank' ? 'Bank transfer' : 'Cash'}`,
    pdf: { engine: 'html', template: template('salary-statement') },
    xlsx: (data) => ({
      columns: [
        { key: 'employeeNo', header: 'Employee no', width: 12 },
        { key: 'fullName', header: 'Name', width: 26 },
        { key: 'designation', header: 'Designation', width: 20 },
        { key: 'department', header: 'Department', width: 20 },
        { key: 'bankAccountNo', header: 'Bank account', width: 20 },
        { key: 'netPayable', header: 'Amount', format: 'money' },
      ],
      rows: data.lines.map((line) => ({ ...line })),
    }),
  });
}

/** Old spGetDeptWiseHrSalarySummary: the approved sheet's totals per department. */
export function departmentSummaryReport(read: PayrollReadRepository): ReportDefinition {
  return defineReport({
    key: 'payroll.department-summary',
    title: 'Department-wise salary summary',
    group: 'Payroll',
    description: "Staff count and salary totals per department for a month's approved sheet.",
    params: z.strictObject(period),
    async load(params) {
      const groups = groupByDepartment(await approvedLines(read, params.year, params.month));
      const rows = groups.map((group) => ({
        department: group.department,
        count: group.lines.length,
        ...group.totals,
      }));
      const all = groups.flatMap((group) => group.lines);
      return { rows, total: { count: all.length, ...totalsOf(all) } };
    },
    describe: (params) => describePeriod(params),
    pdf: { engine: 'html', template: template('department-summary'), landscape: true },
    xlsx: (data) => ({
      columns: [
        { key: 'department', header: 'Department', width: 24 },
        { key: 'count', header: 'Staff', format: 'integer' },
        ...(
          ['gross', 'overtime', 'arrear', 'totalPayable', 'pf', 'incomeTax', 'lwp', 'punishment', 'netPayable'] as const
        ).map((key) => ({ key, header: LABELS[key], format: 'money' as const })),
      ],
      rows: data.rows,
    }),
  });
}

/** Old KhamDocument: one salary envelope per person, printed on 9 × 4 in envelopes. */
export function salaryEnvelopeReport(read: PayrollReadRepository): ReportDefinition {
  return defineReport({
    key: 'payroll.salary-envelope',
    title: 'Salary envelopes',
    group: 'Payroll',
    description: "Envelopes (Kham) with the person's details and net salary from the approved sheet.",
    params: z
      .strictObject({
        ...period,
        staffIds: z.array(z.uuid()).min(1).max(500).optional(),
        departmentId: z.uuid().optional(),
      })
      .refine((value) => !(value.staffIds && value.departmentId), {
        message: 'Give staffIds or departmentId, not both',
      }),
    async load(params) {
      const chosen = params.staffIds ? new Set(params.staffIds) : null;
      const lines = (await approvedLines(read, params.year, params.month)).filter(
        (line) =>
          (!chosen || chosen.has(line.staffId)) && (!params.departmentId || line.departmentId === params.departmentId),
      );
      return { lines, year: params.year, monthName: MONTHS[params.month - 1] };
    },
    pdf: { engine: 'html', template: template('salary-envelope'), bare: true, paper: { width: '9in', height: '4in' } },
  });
}
