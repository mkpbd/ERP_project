import { fileURLToPath } from 'node:url';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { StaffDirectory } from '../../../../shared/application/contracts/staff-directory.js';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { salaryIncrements, salaryPolicies, staffSalaries } from '../persistence/payroll.schema.js';

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
const METHOD_LABELS = { percentage: 'Percentage', fixed: 'Fixed', individual: 'Individual' } as const;
const STATUS_LABELS = { pending: 'Pending', committed: 'Committed' } as const;
const AMOUNTS = [
  'gross',
  'basic',
  'houseRent',
  'medical',
  'conveyance',
  'otherAllowance',
  'specialAllowance',
  'pf',
  'cpf',
] as const;

const total = <T>(rows: readonly T[], amount: (row: T) => number) =>
  Math.round(rows.reduce((sum, row) => sum + amount(row), 0) * 100) / 100;

/** Old IndividualSalaries list / ViewIndividualSalaries export: everyone's salary split, by department. */
export function salaryStructureReport(context: DbContext, staff: StaffDirectory): ReportDefinition {
  return defineReport({
    key: 'payroll.salary-structure',
    title: 'Salary structure',
    group: 'Payroll',
    description: "Each active employee's gross salary and its split, grouped by department, with totals.",
    params: z.strictObject({ departmentId: z.uuid().optional() }),
    async load(params) {
      const people = await staff.search({ departmentId: params.departmentId, activeOnly: true });
      const salaries =
        people.length === 0
          ? []
          : await context.db
              .select({ salary: staffSalaries, policyName: salaryPolicies.name })
              .from(staffSalaries)
              .innerJoin(salaryPolicies, eq(salaryPolicies.id, staffSalaries.policyId))
              .where(
                inArray(
                  staffSalaries.staffId,
                  people.map((person) => person.id),
                ),
              );
      const byStaff = new Map(salaries.map((row) => [row.salary.staffId, row]));
      const rows = people
        .filter((person) => byStaff.has(person.id))
        .sort((a, b) => a.department.localeCompare(b.department) || a.employeeNo.localeCompare(b.employeeNo))
        .map((person) => {
          const { salary, policyName } = byStaff.get(person.id)!;
          return {
            employeeNo: person.employeeNo,
            fullName: person.fullName,
            department: person.department,
            designation: person.designation,
            joiningDate: person.joiningDate,
            policyName,
            ...Object.fromEntries(AMOUNTS.map((key) => [key, salary[key]])),
          } as {
            employeeNo: string;
            fullName: string;
            department: string;
            designation: string;
            joiningDate: string;
            policyName: string;
          } & Record<(typeof AMOUNTS)[number], number>;
        });
      const groups: { department: string; rows: typeof rows }[] = [];
      for (const row of rows) {
        const last = groups.at(-1);
        if (last && last.department === row.department) last.rows.push(row);
        else groups.push({ department: row.department, rows: [row] });
      }
      const totals = Object.fromEntries(AMOUNTS.map((key) => [key, total(rows, (row) => row[key])]));
      return { rows, groups, totals, count: rows.length };
    },
    describe: (_params, data) => (data.groups.length === 1 ? data.groups[0]!.department : 'All departments'),
    pdf: { engine: 'html', template: template('salary-structure'), landscape: true },
    xlsx: (data) => ({
      columns: [
        { key: 'employeeNo', header: 'Employee no', width: 12 },
        { key: 'fullName', header: 'Name', width: 26 },
        { key: 'department', header: 'Department', width: 20 },
        { key: 'designation', header: 'Designation', width: 20 },
        { key: 'joiningDate', header: 'Joined', format: 'date' },
        { key: 'policyName', header: 'Policy', width: 16 },
        { key: 'gross', header: 'Gross', format: 'money' },
        { key: 'basic', header: 'Basic', format: 'money' },
        { key: 'houseRent', header: 'House rent', format: 'money' },
        { key: 'medical', header: 'Medical', format: 'money' },
        { key: 'conveyance', header: 'Conveyance', format: 'money' },
        { key: 'otherAllowance', header: 'Other allowance', format: 'money' },
        { key: 'specialAllowance', header: 'Special allowance', format: 'money' },
        { key: 'pf', header: 'PF', format: 'money' },
        { key: 'cpf', header: 'CPF', format: 'money' },
      ],
      rows: data.rows,
    }),
  });
}

/** Old IncrementStatementEmployeeWise: the month's increments with the salary before and after. */
export function incrementStatementReport(context: DbContext, staff: StaffDirectory): ReportDefinition {
  return defineReport({
    key: 'payroll.increment-statement',
    title: 'Increment statement',
    group: 'Payroll',
    description: "A pay month's increments: previous gross and basic, increment, arrear and gross after.",
    params: z.strictObject({
      year: z.int().min(2000).max(2100),
      month: z.int().min(1).max(12),
      departmentId: z.uuid().optional(),
    }),
    async load(params) {
      const increments = await context.db
        .select()
        .from(salaryIncrements)
        .where(and(eq(salaryIncrements.year, params.year), eq(salaryIncrements.month, params.month)));
      const people = new Map(
        (await staff.findSummaries(increments.map((row) => row.staffId))).map((person) => [person.id, person]),
      );
      const rows = increments
        .flatMap((increment) => {
          const person = people.get(increment.staffId);
          if (!person || (params.departmentId && person.departmentId !== params.departmentId)) return [];
          return [
            {
              employeeNo: person.employeeNo,
              fullName: person.fullName,
              department: person.department,
              designation: person.designation,
              joiningDate: person.joiningDate,
              methodLabel: METHOD_LABELS[increment.method],
              statusLabel: STATUS_LABELS[increment.status],
              previousGross: increment.before.gross,
              previousBasic: increment.before.basic,
              amount: increment.amount,
              arrear: increment.arrear,
              presentGross: Math.round((increment.before.gross + increment.amount) * 100) / 100,
            },
          ];
        })
        .sort((a, b) => a.department.localeCompare(b.department) || a.employeeNo.localeCompare(b.employeeNo));
      return {
        rows,
        totals: { amount: total(rows, (row) => row.amount), arrear: total(rows, (row) => row.arrear) },
      };
    },
    describe: (params) => `${MONTHS[params.month - 1]} ${params.year}`,
    pdf: { engine: 'html', template: template('increment-statement'), landscape: true },
    xlsx: (data) => ({
      columns: [
        { key: 'employeeNo', header: 'Employee no', width: 12 },
        { key: 'fullName', header: 'Name', width: 26 },
        { key: 'designation', header: 'Designation', width: 20 },
        { key: 'department', header: 'Department', width: 20 },
        { key: 'joiningDate', header: 'Joined', format: 'date' },
        { key: 'methodLabel', header: 'Method', width: 12 },
        { key: 'previousGross', header: 'Previous gross', format: 'money' },
        { key: 'previousBasic', header: 'Previous basic', format: 'money' },
        { key: 'amount', header: 'Increment', format: 'money' },
        { key: 'arrear', header: 'Arrear', format: 'money' },
        { key: 'presentGross', header: 'Gross after', format: 'money' },
        { key: 'statusLabel', header: 'Status', width: 12 },
      ],
      rows: data.rows,
    }),
  });
}
