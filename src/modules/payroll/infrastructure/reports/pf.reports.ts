import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { AccessControl } from '../../../../shared/application/contracts/access-control.js';
import type { StaffDirectory } from '../../../../shared/application/contracts/staff-directory.js';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { ForbiddenError } from '../../../../shared/domain/errors.js';
import { pfSettlement, type PfInterestCalculator } from '../../application/ledger.handlers.js';
import { PAYROLL_READ } from '../../application/payroll.constants.js';
import type { PayrollReadRepository } from '../../application/read-models.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));
const matchPercent = z.number().min(0).max(200).default(100);

/** Old PFSettlementReportEmployeeWise: what the fund owes one person; people may print their own. */
export function pfSettlementReport(
  read: PayrollReadRepository,
  staff: StaffDirectory,
  access: AccessControl,
): ReportDefinition {
  return defineReport({
    key: 'payroll.pf-settlement',
    title: 'PF settlement',
    group: 'Payroll',
    description:
      'One person’s PF by year: own contribution, employer’s match, interest and withdrawals, and what is payable.',
    params: z.strictObject({ staffId: z.uuid(), asOf: z.iso.date(), matchPercent }),
    async load(params, context) {
      const own = await staff.staffIdForUser(context.actor.userId);
      if (params.staffId !== own && !(await access.isAllowed(context.actor.userId, { permissions: [PAYROLL_READ] }))) {
        throw new ForbiddenError();
      }
      return pfSettlement(read, staff, params.staffId, params.asOf, params.matchPercent);
    },
    describe: (params, data) =>
      `${data.staff.employeeNo} ${data.staff.fullName} · as of ${params.asOf} · employer's match ${params.matchPercent}%`,
    pdf: { engine: 'html', template: template('pf-settlement') },
  });
}

/** The interest each member would get (or got) in proportion to their PF balance on a date. */
export function pfInterestReport(calculator: PfInterestCalculator): ReportDefinition {
  return defineReport({
    key: 'payroll.pf-interest',
    title: 'PF interest distribution',
    group: 'Payroll',
    description: 'The fund’s interest shared among members in proportion to their PF balances on a date.',
    params: z.strictObject({ asOf: z.iso.date(), amount: z.number().positive().multipleOf(0.01), matchPercent }),
    async load(params) {
      const lines = await calculator.lines(params.asOf, params.amount, params.matchPercent);
      const totalBalance = Math.round(lines.reduce((sum, line) => sum + line.balance * 100, 0)) / 100;
      return { lines, totalBalance, amount: params.amount };
    },
    describe: (params) => `Interest of ${params.amount.toFixed(2)} on balances as of ${params.asOf}`,
    pdf: { engine: 'html', template: template('pf-interest') },
    xlsx: (data) => ({
      columns: [
        { key: 'employeeNo', header: 'Employee no', width: 12 },
        { key: 'fullName', header: 'Name', width: 26 },
        { key: 'department', header: 'Department', width: 20 },
        { key: 'balance', header: 'PF balance', format: 'money' },
        { key: 'interest', header: 'Interest', format: 'money' },
      ],
      rows: data.lines.map((line) => ({ ...line })),
    }),
  });
}
