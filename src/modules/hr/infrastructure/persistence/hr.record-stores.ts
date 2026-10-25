import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { RecordType } from '../../../../shared/application/records.js';
import { DrizzleRecordStore } from '../../../../shared/infrastructure/persistence/drizzle-record-store.js';
import {
  DEPARTMENT_INCHARGE,
  DESIGNATION,
  FESTIVAL,
  GOVT_HOLIDAY,
  HR_DEPARTMENT,
  HR_DIVISION,
  HR_MANAGE,
  HR_MASTERS_MANAGE,
  HR_SUB_DEPARTMENT,
} from '../../application/hr.constants.js';
import {
  departmentIncharges,
  designations,
  festivals,
  govtHolidays,
  hrDepartments,
  hrDivisions,
  hrSubDepartments,
} from './hr.schema.js';

const taken = (code: string, what: string) => ({ code, message: `${what} already exists` });

export function hrRecordTypes(context: DbContext): RecordType[] {
  const masters = { readPermission: null, managePermission: HR_MASTERS_MANAGE };
  return [
    {
      name: HR_DIVISION,
      ...masters,
      store: new DrizzleRecordStore(context, hrDivisions, {
        name: HR_DIVISION,
        orderBy: [hrDivisions.name],
        unique: { hr_divisions_name_uq: taken('hr_division_name_taken', 'A division with this name') },
      }),
    },
    {
      name: HR_DEPARTMENT,
      ...masters,
      store: new DrizzleRecordStore(context, hrDepartments, {
        name: HR_DEPARTMENT,
        orderBy: [hrDepartments.name],
        filters: { divisionId: hrDepartments.divisionId },
        unique: { hr_departments_name_uq: taken('hr_department_name_taken', 'A department with this name') },
        references: { hr_departments_division_id_hr_divisions_id_fk: HR_DIVISION },
      }),
    },
    {
      name: HR_SUB_DEPARTMENT,
      ...masters,
      store: new DrizzleRecordStore(context, hrSubDepartments, {
        name: HR_SUB_DEPARTMENT,
        orderBy: [hrSubDepartments.name],
        filters: { departmentId: hrSubDepartments.departmentId },
        unique: {
          hr_sub_departments_department_name_uq: taken(
            'hr_sub_department_name_taken',
            'A sub-department with this name in this department',
          ),
        },
        references: { hr_sub_departments_department_id_hr_departments_id_fk: HR_DEPARTMENT },
      }),
    },
    {
      name: DESIGNATION,
      ...masters,
      store: new DrizzleRecordStore(context, designations, {
        name: DESIGNATION,
        orderBy: [designations.name],
        unique: { designations_name_uq: taken('designation_name_taken', 'A designation with this name') },
      }),
    },
    {
      name: FESTIVAL,
      ...masters,
      store: new DrizzleRecordStore(context, festivals, {
        name: FESTIVAL,
        orderBy: [festivals.name],
        unique: { festivals_name_uq: taken('festival_name_taken', 'A festival with this name') },
      }),
    },
    {
      name: GOVT_HOLIDAY,
      ...masters,
      store: new DrizzleRecordStore(context, govtHolidays, {
        name: GOVT_HOLIDAY,
        orderBy: [govtHolidays.holidayDate, govtHolidays.name],
        filters: {
          from: { column: govtHolidays.holidayDate, op: 'gte' },
          to: { column: govtHolidays.holidayDate, op: 'lte' },
        },
        unique: { govt_holidays_date_name_uq: taken('govt_holiday_taken', 'A holiday with this name on this date') },
      }),
    },
    {
      // Who heads which department is HR data, changed by hr:manage.
      name: DEPARTMENT_INCHARGE,
      readPermission: null,
      managePermission: HR_MANAGE,
      store: new DrizzleRecordStore(context, departmentIncharges, {
        name: DEPARTMENT_INCHARGE,
        orderBy: [departmentIncharges.appointmentDate],
        filters: { departmentId: departmentIncharges.departmentId, staffId: departmentIncharges.staffId },
        references: {
          department_incharges_department_id_hr_departments_id_fk: HR_DEPARTMENT,
          department_incharges_staff_id_staff_records_id_fk: 'staff',
        },
      }),
    },
  ];
}
