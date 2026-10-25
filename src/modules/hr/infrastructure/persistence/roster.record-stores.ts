import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { RecordType } from '../../../../shared/application/records.js';
import { DrizzleRecordStore } from '../../../../shared/infrastructure/persistence/drizzle-record-store.js';
import { DUTY_EXCHANGE, EXTRA_DUTY, ROSTER_MANAGE, SHIFT_TYPE } from '../../application/hr.constants.js';
import { dutyExchanges, extraDuties, shiftTypes } from './roster.schema.js';

export function rosterRecordTypes(context: DbContext): RecordType[] {
  const roster = { readPermission: null, managePermission: ROSTER_MANAGE };
  return [
    {
      name: SHIFT_TYPE,
      ...roster,
      store: new DrizzleRecordStore(context, shiftTypes, {
        name: SHIFT_TYPE,
        orderBy: [shiftTypes.departmentId, shiftTypes.startTime],
        filters: { departmentId: shiftTypes.departmentId },
        unique: {
          shift_types_department_code_uq: {
            code: 'shift_type_code_taken',
            message: 'The department already has a shift with this code',
          },
        },
        references: { shift_types_department_id_hr_departments_id_fk: 'hr_department' },
      }),
    },
    {
      name: DUTY_EXCHANGE,
      ...roster,
      store: new DrizzleRecordStore(context, dutyExchanges, {
        name: DUTY_EXCHANGE,
        orderBy: [dutyExchanges.dateFrom],
        filters: {
          staffId: dutyExchanges.staffId,
          from: { column: dutyExchanges.dateTo, op: 'gte' },
          to: { column: dutyExchanges.dateFrom, op: 'lte' },
        },
        references: {
          duty_exchanges_staff_id_staff_records_id_fk: 'staff',
          duty_exchanges_exchange_with_staff_id_staff_records_id_fk: 'staff',
        },
      }),
    },
    {
      name: EXTRA_DUTY,
      ...roster,
      store: new DrizzleRecordStore(context, extraDuties, {
        name: EXTRA_DUTY,
        orderBy: [extraDuties.dutyFrom],
        filters: {
          staffId: extraDuties.staffId,
          from: { column: extraDuties.dutyTo, op: 'gte' },
          to: { column: extraDuties.dutyFrom, op: 'lte' },
        },
        references: { extra_duties_staff_id_staff_records_id_fk: 'staff' },
      }),
    },
  ];
}
