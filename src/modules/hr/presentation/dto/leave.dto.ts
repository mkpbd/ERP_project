import { z } from 'zod';
import {
  isoDate,
  pageMetaShape,
  paginationShape,
  recordResponseShape,
  responseDto,
  updateSchema,
} from '../../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../../shared/presentation/zod/zod-dto.js';

const day = z.iso.date();
const text = (max: number) => z.string().trim().max(max).nullable();
const STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;

// ---- masters

const leaveTypeFields = {
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z][A-Za-z0-9-]{0,9}$/, 'Code: 1-10 letters, digits or -, starting with a letter'),
  name: z.string().trim().min(1).max(100),
  nameBn: text(100),
};
export class CreateLeaveTypeDto extends createZodDto(
  z.strictObject({ ...leaveTypeFields, nameBn: leaveTypeFields.nameBn.default(null) }),
) {}
export class UpdateLeaveTypeDto extends createZodDto(updateSchema(leaveTypeFields)) {}
export class LeaveTypeResponseDto extends responseDto(
  recordResponseShape({ code: z.string(), name: z.string(), nameBn: z.string().nullable() }),
) {}

const levelFields = {
  departmentId: z.uuid(),
  levelOrder: z.int().min(1).max(20),
  name: z.string().trim().min(1).max(100),
  approverStaffId: z.uuid(),
};
export class CreateApprovalLevelDto extends createZodDto(z.strictObject(levelFields)) {}
export class UpdateApprovalLevelDto extends createZodDto(updateSchema(levelFields)) {}
export class ApprovalLevelFilterDto extends createZodDto(
  z.object({ departmentId: z.uuid().optional(), approverStaffId: z.uuid().optional() }),
) {}
export class ApprovalLevelResponseDto extends responseDto(
  recordResponseShape({ departmentId: z.uuid(), levelOrder: z.int(), name: z.string(), approverStaffId: z.uuid() }),
) {}

const delegateFields = { staffId: z.uuid(), onBehalfOfStaffId: z.uuid() };
export class CreateLeaveDelegateDto extends createZodDto(z.strictObject(delegateFields)) {}
export class UpdateLeaveDelegateDto extends createZodDto(updateSchema(delegateFields)) {}
export class LeaveDelegateFilterDto extends createZodDto(
  z.object({ staffId: z.uuid().optional(), onBehalfOfStaffId: z.uuid().optional() }),
) {}
export class LeaveDelegateResponseDto extends responseDto(recordResponseShape(delegateFields)) {}

const recordFields = {
  staffId: z.uuid(),
  leaveTypeId: z.uuid(),
  startDate: day,
  endDate: day,
  purpose: text(500),
  remarks: text(500),
};
export class CreateLeaveRecordDto extends createZodDto(
  z
    .strictObject({
      ...recordFields,
      purpose: recordFields.purpose.default(null),
      remarks: recordFields.remarks.default(null),
    })
    .refine((value) => value.startDate <= value.endDate, {
      message: 'endDate must not be before startDate',
      path: ['endDate'],
    }),
) {}
export class UpdateLeaveRecordDto extends createZodDto(updateSchema(recordFields)) {}
export class LeaveRecordFilterDto extends createZodDto(
  z.object({
    staffId: z.uuid().optional(),
    leaveTypeId: z.uuid().optional(),
    from: day.optional(),
    to: day.optional(),
  }),
) {}
export class LeaveRecordResponseDto extends responseDto(
  recordResponseShape({ ...recordFields, startDate: z.string(), endDate: z.string(), days: z.int() }),
) {}

// ---- applications

export class SubmitLeaveDto extends createZodDto(
  z
    .strictObject({
      staffId: z.uuid().optional(),
      leaveTypeId: z.uuid(),
      startDate: day,
      endDate: day,
      reason: z.string().trim().min(1).max(1000),
      substituteStaffId: z.uuid().nullable().default(null),
    })
    .refine((value) => value.startDate <= value.endDate, {
      message: 'endDate must not be before startDate',
      path: ['endDate'],
    }),
) {}

export class ApproveLeaveDto extends createZodDto(
  z.strictObject({
    startDate: day.optional(),
    endDate: day.optional(),
    remarks: z.string().trim().max(500).optional(),
  }),
) {}

export class LeaveDecisionReasonDto extends createZodDto(
  z.strictObject({ reason: z.string().trim().min(1).max(500) }),
) {}

const listFilter = {
  ...paginationShape,
  status: z.enum(STATUSES).optional(),
  from: day.optional(),
  to: day.optional(),
};
export class LeaveApplicationListQueryDto extends createZodDto(
  z.object({ ...listFilter, staffId: z.uuid().optional(), departmentId: z.uuid().optional() }),
) {}
export class MyLeaveApplicationsQueryDto extends createZodDto(z.object(listFilter)) {}

const applicationShape = {
  id: z.uuid(),
  staffId: z.uuid(),
  employeeNo: z.string(),
  staffName: z.string(),
  departmentId: z.uuid(),
  departmentName: z.string(),
  leaveTypeId: z.uuid(),
  leaveTypeName: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  days: z.int(),
  reason: z.string(),
  substituteStaffId: z.uuid().nullable(),
  substituteName: z.string().nullable(),
  status: z.enum(STATUSES),
  currentLevel: z.int(),
  levelCount: z.int(),
  approvedStartDate: z.string().nullable(),
  approvedEndDate: z.string().nullable(),
  approvedDays: z.int().nullable(),
  decisionReason: z.string().nullable(),
  submittedAt: isoDate,
  decidedAt: isoDate.nullable(),
};
export class LeaveApplicationPageResponseDto extends responseDto({
  items: z.array(z.object(applicationShape)),
  ...pageMetaShape,
}) {}
export class LeaveApplicationResponseDto extends responseDto({
  ...applicationShape,
  submittedBy: z.uuid().nullable(),
  nextApprover: z.object({ levelName: z.string(), staffId: z.uuid(), staffName: z.string() }).nullable(),
  approvals: z.array(
    z.object({
      levelOrder: z.int(),
      decision: z.enum(['approved', 'rejected']),
      approverStaffId: z.uuid().nullable(),
      approverName: z.string().nullable(),
      startDate: z.string().nullable(),
      endDate: z.string().nullable(),
      remarks: z.string().nullable(),
      decidedAt: isoDate,
    }),
  ),
}) {}

// ---- balances and policies

export class LeaveYearQueryDto extends createZodDto(z.object({ year: z.coerce.number().int().min(2000).max(2100) })) {}
export class LeaveYearParamDto extends createZodDto(
  z.strictObject({ year: z.coerce.number().int().min(2000).max(2100) }),
) {}
export class StaffLeaveYearParamDto extends createZodDto(
  z.strictObject({ id: z.uuid(), year: z.coerce.number().int().min(2000).max(2100) }),
) {}

export class LeaveBalanceResponseDto extends responseDto({
  leaveTypeId: z.uuid(),
  code: z.string(),
  name: z.string(),
  entitled: z.int().nullable(),
  taken: z.int(),
  pending: z.int(),
  remaining: z.int().nullable(),
}) {}

export class LeavePolicyDto extends createZodDto(
  z.strictObject({
    lateGraceMinutes: z.int().min(0).max(600).default(0),
    lateCountPerDeduction: z.int().min(0).max(31).default(0),
    absentDeduction: z.boolean().default(false),
    entitlements: z.array(z.strictObject({ leaveTypeId: z.uuid(), days: z.int().min(0).max(366) })).max(50),
  }),
) {}

export class LeavePolicyResponseDto extends responseDto({
  year: z.int(),
  lateGraceMinutes: z.int(),
  lateCountPerDeduction: z.int(),
  absentDeduction: z.boolean(),
  entitlements: z.array(z.object({ leaveTypeId: z.uuid(), leaveTypeName: z.string(), days: z.int() })),
  updatedAt: isoDate,
}) {}
