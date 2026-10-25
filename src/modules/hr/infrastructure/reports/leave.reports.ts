import { fileURLToPath } from 'node:url';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { defineReport, type ReportDefinition, type ReportTable } from '../../../../shared/application/reports.js';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import { leaveBalance } from '../../domain/leave.js';
import { DrizzleLeaveReadRepository } from '../persistence/drizzle-leave-read.repository.js';
import { designations, hrDepartments, staffRecords } from '../persistence/hr.schema.js';
import {
  leaveApplications,
  leavePolicies,
  leavePolicyEntitlements,
  leaveRecords,
  leaveTypes,
  staffLeaveEntitlements,
  staffLeavePolicies,
} from '../persistence/leave.schema.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));
const isoDate = z.iso.date();
const year = z.int().min(2000).max(2100);
const STATUS_LABELS = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
} as const;

// Type aliases (not interfaces) so rows satisfy ReportTable's record type.
type ApplicationRow = {
  employeeNo: string;
  staffName: string;
  department: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  approvedDays: number | null;
  status: string;
  decisionReason: string | null;
};

/** Old spGetEmployeeLeaveApplicationList / EmployeeLeaveReport. */
export function leaveApplicationsReport(context: DbContext): ReportDefinition {
  return defineReport({
    key: 'hr.leave-applications',
    title: 'Leave applications',
    group: 'HR',
    description: 'Leave applications overlapping a period, by status and department.',
    params: z
      .strictObject({
        from: isoDate,
        to: isoDate,
        status: z.enum(['pending', 'approved', 'rejected', 'cancelled', 'all']).default('all'),
        departmentId: z.uuid().optional(),
      })
      .refine((value) => value.from <= value.to, { message: 'from must not be after to', path: ['to'] }),
    async load(params): Promise<ApplicationRow[]> {
      const rows = await context.db
        .select({
          employeeNo: staffRecords.employeeNo,
          staffName: staffRecords.fullName,
          department: hrDepartments.name,
          leaveType: leaveTypes.name,
          startDate: leaveApplications.startDate,
          endDate: leaveApplications.endDate,
          days: leaveApplications.days,
          approvedDays: leaveApplications.approvedDays,
          status: leaveApplications.status,
          decisionReason: leaveApplications.decisionReason,
        })
        .from(leaveApplications)
        .innerJoin(staffRecords, eq(staffRecords.id, leaveApplications.staffId))
        .innerJoin(hrDepartments, eq(hrDepartments.id, leaveApplications.departmentId))
        .innerJoin(leaveTypes, eq(leaveTypes.id, leaveApplications.leaveTypeId))
        .where(
          and(
            sql`${leaveApplications.endDate} >= ${params.from}`,
            sql`${leaveApplications.startDate} <= ${params.to}`,
            params.status === 'all' ? undefined : eq(leaveApplications.status, params.status),
            params.departmentId ? eq(leaveApplications.departmentId, params.departmentId) : undefined,
          ),
        )
        .orderBy(asc(leaveApplications.startDate), asc(staffRecords.employeeNo));
      return rows.map((row) => ({ ...row, status: STATUS_LABELS[row.status] }));
    },
    describe: (params) =>
      `${params.from} to ${params.to}` + (params.status === 'all' ? '' : ` · ${STATUS_LABELS[params.status]}`),
    pdf: { engine: 'html', template: template('leave-applications'), landscape: true },
    xlsx: (rows): ReportTable => ({
      columns: [
        { key: 'employeeNo', header: 'Employee no', width: 14 },
        { key: 'staffName', header: 'Name', width: 26 },
        { key: 'department', header: 'Department', width: 20 },
        { key: 'leaveType', header: 'Leave type', width: 18 },
        { key: 'startDate', header: 'From', format: 'date' },
        { key: 'endDate', header: 'To', format: 'date' },
        { key: 'days', header: 'Days', format: 'integer' },
        { key: 'approvedDays', header: 'Approved days', format: 'integer' },
        { key: 'status', header: 'Status' },
        { key: 'decisionReason', header: 'Reason', width: 30 },
      ],
      rows,
    }),
  });
}

type BalanceCell = { entitled: number | null; taken: number; pending: number; remaining: number | null };
type BalanceRow = { employeeNo: string; staffName: string; designation: string; cells: BalanceCell[] };

/** Old EmployeeLeaveBalanceReport / SpGetRemainingLeaveCalculation: every active employee's balance per leave type. */
export function leaveBalancesReport(context: DbContext): ReportDefinition {
  return defineReport({
    key: 'hr.leave-balances',
    title: 'Leave balances',
    group: 'HR',
    description: 'Entitled, taken, pending and remaining days per leave type for every active employee.',
    params: z.strictObject({ year, departmentId: z.uuid().optional() }),
    async load(params) {
      const types = await context.db
        .select({ id: leaveTypes.id, code: leaveTypes.code, name: leaveTypes.name })
        .from(leaveTypes)
        .orderBy(asc(leaveTypes.code));
      const staff = await context.db
        .select({
          id: staffRecords.id,
          employeeNo: staffRecords.employeeNo,
          staffName: staffRecords.fullName,
          designation: designations.name,
          department: hrDepartments.name,
        })
        .from(staffRecords)
        .innerJoin(designations, eq(designations.id, staffRecords.designationId))
        .innerJoin(hrDepartments, eq(hrDepartments.id, staffRecords.departmentId))
        .where(
          and(
            eq(staffRecords.status, 'active'),
            params.departmentId ? eq(staffRecords.departmentId, params.departmentId) : undefined,
          ),
        )
        .orderBy(asc(hrDepartments.name), asc(staffRecords.employeeNo));
      const ids = staff.map((member) => member.id);
      const columnCount = 4 + types.length;
      if (ids.length === 0) return { types, departments: [], total: 0, columnCount };

      const [yearlyPolicy, yearly, overrides, overrideRows, applications, records] = await Promise.all([
        context.db.select({ year: leavePolicies.year }).from(leavePolicies).where(eq(leavePolicies.year, params.year)),
        context.db
          .select({ leaveTypeId: leavePolicyEntitlements.leaveTypeId, days: leavePolicyEntitlements.days })
          .from(leavePolicyEntitlements)
          .where(eq(leavePolicyEntitlements.year, params.year)),
        context.db
          .select({ staffId: staffLeavePolicies.staffId })
          .from(staffLeavePolicies)
          .where(and(eq(staffLeavePolicies.year, params.year), inArray(staffLeavePolicies.staffId, ids))),
        context.db
          .select({
            staffId: staffLeaveEntitlements.staffId,
            leaveTypeId: staffLeaveEntitlements.leaveTypeId,
            days: staffLeaveEntitlements.days,
          })
          .from(staffLeaveEntitlements)
          .where(and(eq(staffLeaveEntitlements.year, params.year), inArray(staffLeaveEntitlements.staffId, ids))),
        context.db
          .select({
            staffId: leaveApplications.staffId,
            leaveTypeId: leaveApplications.leaveTypeId,
            taken: sql<number>`coalesce(sum(${leaveApplications.approvedDays}) filter (where ${leaveApplications.status} = 'approved'), 0)::int`,
            pending: sql<number>`coalesce(sum(coalesce(${leaveApplications.approvedDays}, ${leaveApplications.days})) filter (where ${leaveApplications.status} = 'pending'), 0)::int`,
          })
          .from(leaveApplications)
          .where(
            and(
              inArray(leaveApplications.staffId, ids),
              sql`extract(year from ${leaveApplications.startDate}) = ${params.year}`,
            ),
          )
          .groupBy(leaveApplications.staffId, leaveApplications.leaveTypeId),
        context.db
          .select({
            staffId: leaveRecords.staffId,
            leaveTypeId: leaveRecords.leaveTypeId,
            days: sql<number>`sum(${leaveRecords.days})::int`,
          })
          .from(leaveRecords)
          .where(
            and(inArray(leaveRecords.staffId, ids), sql`extract(year from ${leaveRecords.startDate}) = ${params.year}`),
          )
          .groupBy(leaveRecords.staffId, leaveRecords.leaveTypeId),
      ]);

      const key = (staffId: string, typeId: string) => `${staffId}:${typeId}`;
      const yearlyDays = new Map(yearly.map((row) => [row.leaveTypeId, row.days]));
      const hasOverride = new Set(overrides.map((row) => row.staffId));
      const overrideDays = new Map(overrideRows.map((row) => [key(row.staffId, row.leaveTypeId), row.days]));
      const used = new Map(applications.map((row) => [key(row.staffId, row.leaveTypeId), row]));
      const recorded = new Map(records.map((row) => [key(row.staffId, row.leaveTypeId), row.days]));
      const hasYearly = yearlyPolicy.length > 0;

      const departments: Array<{ department: string; rows: BalanceRow[] }> = [];
      for (const member of staff) {
        const cells = types.map((type): BalanceCell => {
          const k = key(member.id, type.id);
          const entitled = hasOverride.has(member.id)
            ? (overrideDays.get(k) ?? null)
            : hasYearly
              ? (yearlyDays.get(type.id) ?? null)
              : null;
          return leaveBalance(
            type.id,
            entitled,
            (used.get(k)?.taken ?? 0) + (recorded.get(k) ?? 0),
            used.get(k)?.pending ?? 0,
          );
        });
        const row = {
          employeeNo: member.employeeNo,
          staffName: member.staffName,
          designation: member.designation,
          cells,
        };
        const last = departments.at(-1);
        if (last && last.department === member.department) last.rows.push(row);
        else departments.push({ department: member.department, rows: [row] });
      }
      return { types, departments, total: staff.length, columnCount };
    },
    describe: (params) => `Year ${params.year}`,
    pdf: { engine: 'html', template: template('leave-balances'), landscape: true },
    xlsx: (data) => ({
      columns: [
        { key: 'department', header: 'Department', width: 20 },
        { key: 'employeeNo', header: 'Employee no', width: 14 },
        { key: 'staffName', header: 'Name', width: 26 },
        ...data.types.flatMap((type) => [
          { key: `${type.code}-entitled`, header: `${type.code} entitled`, format: 'integer' as const },
          { key: `${type.code}-taken`, header: `${type.code} taken`, format: 'integer' as const },
          { key: `${type.code}-remaining`, header: `${type.code} remaining`, format: 'integer' as const },
        ]),
      ],
      rows: data.departments.flatMap((group) =>
        group.rows.map((row) => ({
          department: group.department,
          employeeNo: row.employeeNo,
          staffName: row.staffName,
          ...Object.fromEntries(
            data.types.flatMap((type, index) => {
              const cell = row.cells[index]!;
              return [
                [`${type.code}-entitled`, cell.entitled],
                [`${type.code}-taken`, cell.taken + cell.pending],
                [`${type.code}-remaining`, cell.remaining],
              ];
            }),
          ),
        })),
      ),
    }),
  });
}

/** Old SpGet_EmployeeWise_LeaveStatement / LeaveRecordStatement / MaternityLeaveStatement for one person. */
export function leaveStatementReport(context: DbContext): ReportDefinition {
  const read = new DrizzleLeaveReadRepository(context);
  return defineReport({
    key: 'hr.leave-statement',
    title: 'Leave statement',
    group: 'HR',
    description: "One employee's balance and every leave taken in a year.",
    params: z.strictObject({ staffId: z.uuid(), year }),
    async load(params) {
      const [member] = await context.db
        .select({
          employeeNo: staffRecords.employeeNo,
          staffName: staffRecords.fullName,
          department: hrDepartments.name,
          designation: designations.name,
          joiningDate: staffRecords.joiningDate,
        })
        .from(staffRecords)
        .innerJoin(hrDepartments, eq(hrDepartments.id, staffRecords.departmentId))
        .innerJoin(designations, eq(designations.id, staffRecords.designationId))
        .where(eq(staffRecords.id, params.staffId));
      if (!member) throw new NotFoundError('staff');
      const [balances, applications, records] = await Promise.all([
        read.balances(params.staffId, params.year),
        context.db
          .select({
            leaveType: leaveTypes.name,
            startDate: sql<string>`coalesce(${leaveApplications.approvedStartDate}, ${leaveApplications.startDate})`,
            endDate: sql<string>`coalesce(${leaveApplications.approvedEndDate}, ${leaveApplications.endDate})`,
            days: sql<number>`coalesce(${leaveApplications.approvedDays}, ${leaveApplications.days})`,
            status: leaveApplications.status,
            note: leaveApplications.reason,
          })
          .from(leaveApplications)
          .innerJoin(leaveTypes, eq(leaveTypes.id, leaveApplications.leaveTypeId))
          .where(
            and(
              eq(leaveApplications.staffId, params.staffId),
              inArray(leaveApplications.status, ['approved', 'pending']),
              sql`extract(year from ${leaveApplications.startDate}) = ${params.year}`,
            ),
          ),
        context.db
          .select({
            leaveType: leaveTypes.name,
            startDate: leaveRecords.startDate,
            endDate: leaveRecords.endDate,
            days: leaveRecords.days,
            note: leaveRecords.purpose,
          })
          .from(leaveRecords)
          .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRecords.leaveTypeId))
          .where(
            and(
              eq(leaveRecords.staffId, params.staffId),
              sql`extract(year from ${leaveRecords.startDate}) = ${params.year}`,
            ),
          ),
      ]);
      const entries = [
        ...applications.map((row) => ({
          ...row,
          source: row.status === 'pending' ? 'Application (pending)' : 'Application',
        })),
        ...records.map((row) => ({ ...row, source: 'Recorded by HR' })),
      ].sort((a, b) => a.startDate.localeCompare(b.startDate));
      return { member, balances: balances.rows, hasPolicy: balances.hasPolicy, entries };
    },
    describe: (params, data) => `${data.member.employeeNo} — ${data.member.staffName} · ${params.year}`,
    pdf: { engine: 'html', template: template('leave-statement') },
  });
}
