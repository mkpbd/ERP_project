import { fileURLToPath } from 'node:url';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { LocationDirectory } from '../../../../shared/application/contracts/location-directory.js';
import { defineReport, type ReportDefinition, type ReportTable } from '../../../../shared/application/reports.js';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import {
  designations,
  hrDepartments,
  hrSubDepartments,
  staffEducation,
  staffEmergencyContacts,
  staffPhotos,
  staffRecords,
} from '../persistence/hr.schema.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));
const isoDate = z.iso.date();

const STATUS_LABELS = { active: 'Active', inactive: 'Inactive', separated: 'Separated' } as const;

// Type aliases (not interfaces) so rows satisfy ReportTable's record type.
type EmployeeRow = {
  employeeNo: string;
  fullName: string;
  department: string;
  subDepartment: string;
  designation: string;
  joiningDate: string;
  status: keyof typeof STATUS_LABELS;
  statusReason: string | null;
  separationDate: string | null;
};

type EmployeeGroup = { department: string; rows: EmployeeRow[] };

function groupByDepartment(rows: EmployeeRow[]): { groups: EmployeeGroup[]; total: number } {
  const groups: EmployeeGroup[] = [];
  for (const row of rows) {
    const last = groups.at(-1);
    if (last && last.department === row.department) last.rows.push(row);
    else groups.push({ department: row.department, rows: [row] });
  }
  return { groups, total: rows.length };
}

const employeeTable = (rows: EmployeeRow[]): ReportTable => ({
  columns: [
    { key: 'employeeNo', header: 'Employee no', width: 14 },
    { key: 'fullName', header: 'Name', width: 28 },
    { key: 'department', header: 'Department', width: 22 },
    { key: 'subDepartment', header: 'Sub-department', width: 22 },
    { key: 'designation', header: 'Designation', width: 22 },
    { key: 'joiningDate', header: 'Joining date', format: 'date' },
    { key: 'status', header: 'Status' },
    { key: 'statusReason', header: 'Reason', width: 30 },
    { key: 'separationDate', header: 'Separation date', format: 'date' },
  ],
  rows: rows.map((row) => ({ ...row, status: STATUS_LABELS[row.status] })),
});

function employeeQuery(context: DbContext) {
  return context.db
    .select({
      employeeNo: staffRecords.employeeNo,
      fullName: staffRecords.fullName,
      department: hrDepartments.name,
      subDepartment: hrSubDepartments.name,
      designation: designations.name,
      joiningDate: staffRecords.joiningDate,
      status: staffRecords.status,
      statusReason: staffRecords.statusReason,
      separationDate: staffRecords.separationDate,
    })
    .from(staffRecords)
    .innerJoin(hrDepartments, eq(hrDepartments.id, staffRecords.departmentId))
    .innerJoin(hrSubDepartments, eq(hrSubDepartments.id, staffRecords.subDepartmentId))
    .innerJoin(designations, eq(designations.id, staffRecords.designationId))
    .$dynamic();
}

/** Old ActiveEmployee, InActiveEmployee, SeparatedEmployee, EmployeeListActiveInactive and DepartmentWiseEmployee. */
export function employeeListReport(context: DbContext): ReportDefinition {
  return defineReport({
    key: 'hr.employee-list',
    title: 'Employee list',
    group: 'HR',
    description: 'Employees by department, filtered by status.',
    params: z.strictObject({
      status: z.enum(['active', 'inactive', 'separated', 'all']).default('active'),
      departmentId: z.uuid().optional(),
    }),
    async load(params) {
      const rows = await employeeQuery(context)
        .where(
          and(
            params.status === 'all' ? undefined : eq(staffRecords.status, params.status),
            params.departmentId ? eq(staffRecords.departmentId, params.departmentId) : undefined,
          ),
        )
        .orderBy(asc(hrDepartments.name), asc(staffRecords.employeeNo));
      return { rows, ...groupByDepartment(rows) };
    },
    describe: (params, data) =>
      [
        params.status === 'all' ? 'All statuses' : `Status: ${STATUS_LABELS[params.status]}`,
        params.departmentId ? `Department: ${data.rows[0]?.department ?? '—'}` : 'All departments',
      ].join(' · '),
    pdf: { engine: 'html', template: template('employee-list'), landscape: true },
    xlsx: (data) => employeeTable(data.rows),
  });
}

/** Old NewEmployeeList (the salary column comes with Payroll, step 5). */
export function newEmployeesReport(context: DbContext): ReportDefinition {
  return defineReport({
    key: 'hr.new-employees',
    title: 'New employees',
    group: 'HR',
    description: 'Employees who joined in a date range.',
    params: z
      .strictObject({ from: isoDate, to: isoDate, departmentId: z.uuid().optional() })
      .refine((value) => value.from <= value.to, { message: 'from must not be after to', path: ['to'] }),
    async load(params) {
      const rows = await employeeQuery(context)
        .where(
          and(
            gte(staffRecords.joiningDate, params.from),
            lte(staffRecords.joiningDate, params.to),
            params.departmentId ? eq(staffRecords.departmentId, params.departmentId) : undefined,
          ),
        )
        .orderBy(asc(staffRecords.joiningDate), asc(staffRecords.employeeNo));
      return { rows, ...groupByDepartment(rows) };
    },
    describe: (params) => `Joined ${params.from} to ${params.to}`,
    pdf: { engine: 'html', template: template('employee-list'), landscape: true },
    xlsx: (data) => employeeTable(data.rows),
  });
}

/** Old print-cv (PrintEmployeeCVQuery): one employee's full profile. */
export function employeeCvReport(context: DbContext, locations: LocationDirectory): ReportDefinition {
  return defineReport({
    key: 'hr.employee-cv',
    title: 'Employee profile',
    group: 'HR',
    description: "One employee's personal, employment and education details.",
    params: z.strictObject({ staffId: z.uuid() }),
    async load(params) {
      const [row] = await context.db
        .select({
          staff: staffRecords,
          department: hrDepartments.name,
          subDepartment: hrSubDepartments.name,
          designation: designations.name,
          photoType: staffPhotos.contentType,
          photo: staffPhotos.data,
        })
        .from(staffRecords)
        .innerJoin(hrDepartments, eq(hrDepartments.id, staffRecords.departmentId))
        .innerJoin(hrSubDepartments, eq(hrSubDepartments.id, staffRecords.subDepartmentId))
        .innerJoin(designations, eq(designations.id, staffRecords.designationId))
        .leftJoin(staffPhotos, eq(staffPhotos.staffId, staffRecords.id))
        .where(eq(staffRecords.id, params.staffId));
      if (!row) throw new NotFoundError('staff');
      const nationality = row.staff.nationalityCountryId
        ? await locations.nationality(row.staff.nationalityCountryId)
        : null;
      const [education, contacts] = await Promise.all([
        context.db
          .select()
          .from(staffEducation)
          .where(eq(staffEducation.staffId, params.staffId))
          .orderBy(asc(staffEducation.position)),
        context.db
          .select()
          .from(staffEmergencyContacts)
          .where(eq(staffEmergencyContacts.staffId, params.staffId))
          .orderBy(asc(staffEmergencyContacts.position)),
      ]);
      return {
        ...row.staff,
        department: row.department,
        subDepartment: row.subDepartment,
        designation: row.designation,
        nationality: nationality ?? row.staff.nationalityOther,
        statusLabel: STATUS_LABELS[row.staff.status],
        photoDataUri:
          row.photo && row.photoType ? `data:${row.photoType};base64,${row.photo.toString('base64')}` : null,
        education,
        contacts,
      };
    },
    describe: (_params, data) => `${data.employeeNo} — ${data.fullName}`,
    pdf: { engine: 'html', template: template('employee-cv') },
  });
}
