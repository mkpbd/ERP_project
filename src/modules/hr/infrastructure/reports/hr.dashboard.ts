import { sql } from 'drizzle-orm';
import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { DashboardSection } from '../../../../shared/application/dashboards.js';
import { sqlHead } from '../../../../shared/infrastructure/persistence/dashboard-heads.js';
import { hrDepartments, staffRecords } from '../persistence/hr.schema.js';

const department = {
  label: 'Department',
  expr: sql`(select ${hrDepartments.name} from ${hrDepartments} where ${hrDepartments.id} = ${staffRecords.departmentId})`,
};

/** Old HR dashboard: the staff now, who joined and who left. Attendance and payroll are their own reports. */
export function hrDashboard(context: DbContext): DashboardSection {
  const head = (spec: Parameters<typeof sqlHead>[1]) => sqlHead(context, spec);
  return {
    key: 'staff',
    title: 'Staff',
    order: 70,
    permissions: ['hr:read'],
    heads: [
      head({
        key: 'staff.active',
        label: 'Staff now',
        unit: 'count',
        hint: 'Active staff records',
        from: sql`${staffRecords}`,
        where: () => sql`${staffRecords.status} = 'active'`,
        value: sql`count(*)`,
        dimensions: { department, nature: { label: 'Service nature', expr: sql`${staffRecords.serviceNature}` } },
      }),
      head({
        key: 'staff.joined',
        label: 'Joined',
        unit: 'count',
        from: sql`${staffRecords}`,
        day: () => sql`${staffRecords.joiningDate}`,
        value: sql`count(*)`,
        dimensions: { department },
      }),
      head({
        key: 'staff.separated',
        label: 'Separated',
        unit: 'count',
        from: sql`${staffRecords}`,
        day: () => sql`${staffRecords.separationDate}`,
        where: () => sql`${staffRecords.status} = 'separated'`,
        value: sql`count(*)`,
        dimensions: { department },
      }),
    ],
  };
}
