import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { AccessControl } from '../../../../shared/application/contracts/access-control.js';
import type { StaffDirectory } from '../../../../shared/application/contracts/staff-directory.js';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { ForbiddenError, NotFoundError } from '../../../../shared/domain/errors.js';
import { taxCertificate } from '../../application/income-tax.handlers.js';
import { PAYROLL_READ } from '../../application/payroll.constants.js';
import type { PayrollReadRepository } from '../../application/read-models.js';
import type { IncomeTaxRepository } from '../../domain/repositories.js';

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
const INCOME_LABELS = {
  basic: 'Basic',
  houseRent: 'House rent',
  medical: 'Medical allowance',
  conveyance: 'Conveyance',
  otherAllowance: 'Other allowance',
  overtime: 'Overtime',
  allowance: 'Allowances paid',
  specialAllowance: 'Special allowance',
  arrear: 'Arrear',
  pf: "Employer's PF contribution",
  festivalBonus: 'Festival bonus',
  leaveEncashment: 'Leave encashment',
} as const;

/** Old SpGetSalaryCertificateForIncomeTax…RunningYear print: one person's tax certificate for a tax year so far. */
export function taxCertificateReport(
  taxes: IncomeTaxRepository,
  staff: StaffDirectory,
  access: AccessControl,
): ReportDefinition {
  return defineReport({
    key: 'payroll.tax-certificate',
    title: 'Salary certificate for income tax',
    group: 'Payroll',
    description: "One person's income, exemption, slab tax, rebate and deductions for a tax year so far.",
    params: z.strictObject({ taxYearId: z.uuid(), staffId: z.uuid() }),
    async load(params, context) {
      const own = await staff.staffIdForUser(context.actor.userId);
      if (params.staffId !== own && !(await access.isAllowed(context.actor.userId, { permissions: [PAYROLL_READ] }))) {
        throw new ForbiddenError();
      }
      const view = await taxCertificate(taxes, staff, params.taxYearId, params.staffId);
      return {
        ...view,
        incomeRows: (Object.keys(INCOME_LABELS) as (keyof typeof INCOME_LABELS)[]).map((key) => ({
          label: INCOME_LABELS[key],
          amount: view.certificate.received[key],
        })),
      };
    },
    describe: (_params, data) => `${data.taxYear.label} · ${data.staff.employeeNo} ${data.staff.fullName}`,
    pdf: { engine: 'html', template: template('tax-certificate') },
  });
}

/** Old SpGetTaxMonthlyStatement: income tax deducted on a month's saved salary sheet. */
export function taxMonthlyReport(read: PayrollReadRepository): ReportDefinition {
  return defineReport({
    key: 'payroll.tax-monthly',
    title: 'Income tax deduction statement',
    group: 'Payroll',
    description: "Income tax deducted from each person on a month's saved salary sheet.",
    params: z.strictObject({ year: z.int().min(2000).max(2100), month: z.int().min(1).max(12) }),
    async load(params) {
      const saved = await read.savedSheet(params.year, params.month);
      if (!saved) throw new NotFoundError('salary_sheet');
      const lines = saved.lines
        .filter((line) => line.incomeTax > 0)
        .sort((a, b) => a.employeeNo.localeCompare(b.employeeNo))
        .map((line) => ({ ...line, amount: line.incomeTax }));
      return { label: 'Income tax', lines, total: lines.reduce((sum, line) => sum + line.incomeTax, 0) };
    },
    describe: (params) => `${MONTHS[params.month - 1]} ${params.year}`,
    pdf: { engine: 'html', template: template('deduction-statement') },
    xlsx: (data) => ({
      columns: [
        { key: 'employeeNo', header: 'Employee no', width: 12 },
        { key: 'fullName', header: 'Name', width: 26 },
        { key: 'designation', header: 'Designation', width: 20 },
        { key: 'department', header: 'Department', width: 20 },
        { key: 'incomeTax', header: 'Income tax', format: 'money' },
      ],
      rows: data.lines.map((line) => ({ ...line })),
    }),
  });
}
