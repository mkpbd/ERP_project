import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { RecordType } from '../../../../shared/application/records.js';
import { DrizzleRecordStore } from '../../../../shared/infrastructure/persistence/drizzle-record-store.js';
import {
  HR_MASTERS_MANAGE,
  LEAVE_APPROVAL_LEVEL,
  LEAVE_DELEGATE,
  LEAVE_MANAGE,
  LEAVE_READ,
  LEAVE_RECORD,
  LEAVE_TYPE,
} from '../../application/hr.constants.js';
import { leaveApprovalLevels, leaveDelegates, leaveRecords, leaveTypes } from './leave.schema.js';

export function leaveRecordTypes(context: DbContext): RecordType[] {
  return [
    {
      name: LEAVE_TYPE,
      readPermission: null,
      managePermission: HR_MASTERS_MANAGE,
      store: new DrizzleRecordStore(context, leaveTypes, {
        name: LEAVE_TYPE,
        orderBy: [leaveTypes.code],
        unique: {
          leave_types_code_uq: { code: 'leave_type_code_taken', message: 'A leave type with this code already exists' },
          leave_types_name_uq: { code: 'leave_type_name_taken', message: 'A leave type with this name already exists' },
        },
      }),
    },
    {
      name: LEAVE_APPROVAL_LEVEL,
      readPermission: null,
      managePermission: LEAVE_MANAGE,
      store: new DrizzleRecordStore(context, leaveApprovalLevels, {
        name: LEAVE_APPROVAL_LEVEL,
        orderBy: [leaveApprovalLevels.departmentId, leaveApprovalLevels.levelOrder],
        filters: {
          departmentId: leaveApprovalLevels.departmentId,
          approverStaffId: leaveApprovalLevels.approverStaffId,
        },
        unique: {
          leave_approval_levels_department_order_uq: {
            code: 'approval_level_taken',
            message: 'The department already has this approval level',
          },
        },
        references: {
          leave_approval_levels_department_id_hr_departments_id_fk: 'hr_department',
          leave_approval_levels_approver_staff_id_staff_records_id_fk: 'staff',
        },
      }),
    },
    {
      name: LEAVE_DELEGATE,
      readPermission: LEAVE_READ,
      managePermission: LEAVE_MANAGE,
      store: new DrizzleRecordStore(context, leaveDelegates, {
        name: LEAVE_DELEGATE,
        orderBy: [leaveDelegates.staffId],
        filters: { staffId: leaveDelegates.staffId, onBehalfOfStaffId: leaveDelegates.onBehalfOfStaffId },
        unique: {
          leave_delegates_pair_uq: { code: 'leave_delegate_exists', message: 'This delegation already exists' },
        },
        references: {
          leave_delegates_staff_id_staff_records_id_fk: 'staff',
          leave_delegates_on_behalf_of_staff_id_staff_records_id_fk: 'staff',
        },
      }),
    },
    {
      // Leave entered directly by HR (old LeaveRecords / MaternityLeaveRecords); counts against the balance.
      name: LEAVE_RECORD,
      readPermission: LEAVE_READ,
      managePermission: LEAVE_MANAGE,
      store: new DrizzleRecordStore(context, leaveRecords, {
        name: LEAVE_RECORD,
        orderBy: [leaveRecords.startDate],
        filters: {
          staffId: leaveRecords.staffId,
          leaveTypeId: leaveRecords.leaveTypeId,
          from: { column: leaveRecords.endDate, op: 'gte' },
          to: { column: leaveRecords.startDate, op: 'lte' },
        },
        references: {
          leave_records_staff_id_staff_records_id_fk: 'staff',
          leave_records_leave_type_id_leave_types_id_fk: LEAVE_TYPE,
        },
      }),
    },
  ];
}
