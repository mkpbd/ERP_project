import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { defineReport, type ReportDefinition, type ReportTable } from '../../../../shared/application/reports.js';
import { computeAttendance, type StaffAttendanceRow } from '../../application/attendance.read-models.js';
import type { AttendanceStatus } from '../../domain/attendance.js';
import { addDays, zonedInstant } from '../../domain/roster.js';
import { DrizzleAttendanceReadRepository } from '../persistence/drizzle-attendance.repositories.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));
const isoDate = z.iso.date();
const scope = { departmentId: z.uuid().optional(), subDepartmentId: z.uuid().optional() };

export const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
  leave: 'Leave',
  'day-off': 'Day off',
  holiday: 'Holiday',
};

const dayTable = (rows: StaffAttendanceRow[], withName: boolean): ReportTable => ({
  columns: [
    ...(withName
      ? [
          { key: 'employeeNo', header: 'Employee no', width: 12 },
          { key: 'fullName', header: 'Name', width: 24 },
          { key: 'departmentName', header: 'Department', width: 18 },
        ]
      : []),
    { key: 'date', header: 'Date', format: 'date' as const },
    { key: 'shift', header: 'Shift' },
    { key: 'inAt', header: 'In', format: 'datetime' as const, width: 18 },
    { key: 'outAt', header: 'Out', format: 'datetime' as const, width: 18 },
    { key: 'status', header: 'Status' },
    { key: 'lateMinutes', header: 'Late (min)', format: 'integer' as const },
    { key: 'earlyOutMinutes', header: 'Early out (min)', format: 'integer' as const },
    { key: 'workMinutes', header: 'Worked (min)', format: 'integer' as const },
    { key: 'overtimeMinutes', header: 'Overtime (min)', format: 'integer' as const },
    { key: 'note', header: 'Note', width: 20 },
  ],
  rows: rows.map((row) => ({ ...row, status: STATUS_LABELS[row.status] })),
});

/** Old DailyAttendanceReport: everyone's attendance on one date. */
export function dailyAttendanceReport(context: DbContext): ReportDefinition {
  const read = new DrizzleAttendanceReadRepository(context);
  return defineReport({
    key: 'hr.attendance-daily',
    title: 'Daily attendance',
    group: 'HR',
    description: "Every active employee's in/out times and status on one date.",
    params: z.strictObject({ date: isoDate, ...scope }),
    async load(params, ctx) {
      const facts = await read.facts(params, params.date, params.date, ctx.timeZone);
      const rows = computeAttendance(facts, params.date, params.date, ctx.timeZone);
      const counts = Object.fromEntries(
        (Object.keys(STATUS_LABELS) as AttendanceStatus[]).map((status) => [
          status,
          rows.filter((row) => row.status === status).length,
        ]),
      );
      return { rows, counts, labels: STATUS_LABELS };
    },
    describe: (params) => `Date: ${params.date}`,
    pdf: { engine: 'html', template: template('attendance-daily'), landscape: true },
    xlsx: (data) => dayTable(data.rows, true),
  });
}

/** Old MonthlyAttendanceReport / AttendanceReportSummary / FingerPrintReport28-31: one line per employee for a month. */
export function monthlyAttendanceReport(context: DbContext): ReportDefinition {
  const read = new DrizzleAttendanceReadRepository(context);
  return defineReport({
    key: 'hr.attendance-monthly',
    title: 'Monthly attendance',
    group: 'HR',
    description: 'Per employee: a letter per day and the month totals (present, late, absent, leave, days off).',
    params: z.strictObject({ year: z.int().min(2000).max(2100), month: z.int().min(1).max(12), ...scope }),
    async load(params, ctx) {
      const from = `${params.year}-${String(params.month).padStart(2, '0')}-01`;
      const to = addDays(
        params.month === 12
          ? `${params.year + 1}-01-01`
          : `${params.year}-${String(params.month + 1).padStart(2, '0')}-01`,
        -1,
      );
      const facts = await read.facts(params, from, to, ctx.timeZone);
      const rows = computeAttendance(facts, from, to, ctx.timeZone);
      const days: string[] = [];
      for (let date = from; date <= to; date = addDays(date, 1)) days.push(date);
      const LETTER: Record<AttendanceStatus, string> = {
        present: 'P',
        late: 'L',
        absent: 'A',
        leave: 'LV',
        'day-off': 'O',
        holiday: 'H',
      };
      const staff = facts.staff.map((member) => {
        const own = rows.filter((row) => row.staffId === member.id);
        const total = (status: AttendanceStatus) => own.filter((row) => row.status === status).length;
        return {
          employeeNo: member.employeeNo,
          fullName: member.fullName,
          departmentName: member.departmentName,
          cells: own.map((row) => ({ letter: LETTER[row.status], status: row.status })),
          present: total('present') + total('late'),
          late: total('late'),
          absent: total('absent'),
          leave: total('leave'),
          dayOff: total('day-off') + total('holiday'),
          lateMinutes: own.reduce((sum, row) => sum + (row.status === 'late' ? row.lateMinutes : 0), 0),
          overtimeMinutes: own.reduce((sum, row) => sum + row.overtimeMinutes, 0),
        };
      });
      return { days: days.map((date) => Number(date.slice(8))), staff };
    },
    describe: (params) =>
      new Date(Date.UTC(params.year, params.month - 1)).toLocaleString('en-GB', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }),
    pdf: { engine: 'html', template: template('attendance-monthly'), landscape: true, pageSize: 'Legal' },
    xlsx: (data) => ({
      columns: [
        { key: 'employeeNo', header: 'Employee no', width: 12 },
        { key: 'fullName', header: 'Name', width: 24 },
        { key: 'departmentName', header: 'Department', width: 18 },
        ...data.days.map((day) => ({ key: `d${day}`, header: String(day), width: 4 })),
        { key: 'present', header: 'Present', format: 'integer' as const },
        { key: 'late', header: 'Late', format: 'integer' as const },
        { key: 'absent', header: 'Absent', format: 'integer' as const },
        { key: 'leave', header: 'Leave', format: 'integer' as const },
        { key: 'dayOff', header: 'Off/holiday', format: 'integer' as const },
        { key: 'lateMinutes', header: 'Late minutes', format: 'integer' as const },
        { key: 'overtimeMinutes', header: 'Overtime minutes', format: 'integer' as const },
      ],
      rows: data.staff.map(({ cells, ...member }) => ({
        ...member,
        ...Object.fromEntries(cells.map((cell, index) => [`d${data.days[index]}`, cell.letter])),
      })),
    }),
  });
}

/** Old AttendanceReportEmployeeWise / IndividualAttendanceReport / EmployeePunchHistory. */
export function individualAttendanceReport(context: DbContext): ReportDefinition {
  const read = new DrizzleAttendanceReadRepository(context);
  return defineReport({
    key: 'hr.attendance-individual',
    title: 'Attendance statement',
    group: 'HR',
    description: "One employee's day-by-day attendance and raw punches for up to 62 days.",
    params: z
      .strictObject({ staffId: z.uuid(), from: isoDate, to: isoDate })
      .refine((value) => value.from <= value.to && value.to <= addDays(value.from, 61), {
        message: 'Give a range of up to 62 days',
        path: ['to'],
      }),
    async load(params, ctx) {
      const facts = await read.facts({ staffIds: [params.staffId] }, params.from, params.to, ctx.timeZone);
      const member = facts.staff[0];
      const rows = computeAttendance(facts, params.from, params.to, ctx.timeZone);
      const punches = await read.punches(
        params.staffId,
        zonedInstant(params.from, '00:00', ctx.timeZone),
        zonedInstant(addDays(params.to, 1), '00:00', ctx.timeZone),
      );
      return { member: member ?? null, rows, punches, labels: STATUS_LABELS };
    },
    describe: (params, data) =>
      `${data.member ? `${data.member.employeeNo} — ${data.member.fullName} · ` : ''}${params.from} to ${params.to}`,
    pdf: { engine: 'html', template: template('attendance-individual') },
    xlsx: (data) => dayTable(data.rows, false),
  });
}
