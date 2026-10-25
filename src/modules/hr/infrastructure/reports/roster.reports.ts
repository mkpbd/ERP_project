import { fileURLToPath } from 'node:url';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { defineReport, type ReportDefinition, type ReportTable } from '../../../../shared/application/reports.js';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import { addDays } from '../../domain/roster.js';
import { DrizzleRosterReadRepository, DrizzleRosterRepository } from '../persistence/drizzle-roster.repositories.js';
import { hrDepartments, hrSubDepartments } from '../persistence/hr.schema.js';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/** Old RoasterCalender/GetReport: the month's duty roster of one sub-department as a grid. */
export function dutyRosterReport(context: DbContext): ReportDefinition {
  const read = new DrizzleRosterReadRepository(context);
  const roster = new DrizzleRosterRepository(context);
  return defineReport({
    key: 'hr.duty-roster',
    title: 'Duty roster',
    group: 'HR',
    description: "A sub-department's monthly duty roster: shifts and days off per person per day.",
    params: z.strictObject({
      departmentId: z.uuid(),
      subDepartmentId: z.uuid(),
      year: z.int().min(2000).max(2100),
      month: z.int().min(1).max(12),
    }),
    async load(params) {
      const [scope] = await context.db
        .select({ department: hrDepartments.name, subDepartment: hrSubDepartments.name })
        .from(hrSubDepartments)
        .innerJoin(hrDepartments, eq(hrDepartments.id, hrSubDepartments.departmentId))
        .where(eq(hrSubDepartments.id, params.subDepartmentId))
        .orderBy(asc(hrSubDepartments.name));
      if (!scope) throw new NotFoundError('hr_sub_department');

      const firstDay = `${params.year}-${String(params.month).padStart(2, '0')}-01`;
      const lastDay = addDays(
        params.month === 12
          ? `${params.year + 1}-01-01`
          : `${params.year}-${String(params.month + 1).padStart(2, '0')}-01`,
        -1,
      );
      const [staff, shiftTypes, holidays] = await Promise.all([
        read.staff(params.departmentId, params.subDepartmentId, firstDay, lastDay),
        read.shiftTypes(params.departmentId),
        read.govtHolidays(firstDay, lastDay),
      ]);
      const ids = staff.map((member) => member.id);
      const [duties, daysOff] = await Promise.all([
        roster.duties(ids, firstDay, lastDay),
        roster.daysOff(ids, firstDay, lastDay),
      ]);

      const holidayDates = new Map(holidays.map((holiday) => [holiday.date, holiday.name]));
      const days: Array<{ date: string; day: number; weekday: string; holiday: string | null }> = [];
      for (let date = firstDay; date <= lastDay; date = addDays(date, 1)) {
        days.push({
          date,
          day: Number(date.slice(8)),
          weekday: WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!,
          holiday: holidayDates.get(date) ?? null,
        });
      }
      const rows = staff.map((member) => ({
        employeeNo: member.employeeNo,
        fullName: member.fullName,
        designation: member.designationName,
        cells: days.map(({ date, holiday }) => {
          const off = daysOff.some((entry) => entry.staffId === member.id && entry.date === date);
          const codes = duties
            .filter((duty) => duty.staffId === member.id && duty.dutyDate === date)
            .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
            .map((duty) => duty.code);
          return { text: off ? 'OFF' : codes.join('/'), off, holiday: holiday !== null };
        }),
      }));
      return { ...scope, days, rows, shiftTypes, holidays };
    },
    describe: (params, data) =>
      `${data.department} / ${data.subDepartment} · ${new Date(Date.UTC(params.year, params.month - 1)).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`,
    pdf: {
      engine: 'html',
      template: fileURLToPath(new URL('./duty-roster.hbs', import.meta.url)),
      landscape: true,
      pageSize: 'Legal',
    },
    xlsx: (data): ReportTable => ({
      columns: [
        { key: 'employeeNo', header: 'Employee no', width: 12 },
        { key: 'fullName', header: 'Name', width: 24 },
        ...data.days.map((day) => ({ key: day.date, header: `${day.day} ${day.weekday}`, width: 6 })),
      ],
      rows: data.rows.map((row) => ({
        employeeNo: row.employeeNo,
        fullName: row.fullName,
        ...Object.fromEntries(data.days.map((day, index) => [day.date, row.cells[index]!.text])),
      })),
    }),
  });
}
