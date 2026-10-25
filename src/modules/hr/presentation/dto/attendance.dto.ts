import { z } from 'zod';
import {
  isoDate,
  pageMetaShape,
  paginationShape,
  responseDto,
} from '../../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../../shared/presentation/zod/zod-dto.js';

const day = z.iso.date();
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected a time HH:mm (24-hour)');
const MANUAL_STATUSES = ['draft', 'pending', 'approved', 'rejected', 'cancelled'] as const;
const STATUSES = ['leave', 'day-off', 'holiday', 'absent', 'late', 'present'] as const;

export class IngestPunchesDto extends createZodDto(
  z.strictObject({
    punches: z
      .array(
        z.strictObject({
          biometricNo: z.int().min(0).max(2_147_483_647),
          machineNo: z.int().min(0).max(32_767).default(0),
          /** With an explicit offset, e.g. 2026-11-10T08:02:11+06:00. */
          punchedAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
        }),
      )
      .min(1)
      .max(5000),
  }),
) {}

export class PunchIngestResponseDto extends responseDto({
  received: z.int(),
  accepted: z.int(),
  duplicates: z.int(),
  unmatchedBiometricNos: z.array(z.int()),
}) {}

export class DailyAttendanceQueryDto extends createZodDto(
  z.object({ date: day, departmentId: z.uuid().optional(), subDepartmentId: z.uuid().optional() }),
) {}
export class AttendanceRangeQueryDto extends createZodDto(z.object({ from: day, to: day })) {}

export class AttendanceDayResponseDto extends responseDto({
  staffId: z.uuid(),
  employeeNo: z.string(),
  fullName: z.string(),
  departmentName: z.string(),
  designationName: z.string(),
  date: z.string(),
  status: z.enum(STATUSES),
  shift: z.string().nullable(),
  inAt: isoDate.nullable(),
  outAt: isoDate.nullable(),
  lateMinutes: z.int(),
  earlyOutMinutes: z.int(),
  workMinutes: z.int(),
  overtimeMinutes: z.int(),
  source: z.enum(['device', 'manual']).nullable(),
  note: z.string().nullable(),
}) {}

export class PunchResponseDto extends responseDto({ punchedAt: isoDate, machineNo: z.int() }) {}

const times = {
  inTime: clock.nullable().default(null),
  outTime: clock.nullable().default(null),
};

export class CreateManualAttendanceDto extends createZodDto(
  z.strictObject({
    staffId: z.uuid(),
    date: day,
    ...times,
    reason: z.string().trim().min(1).max(500),
    submit: z.boolean().default(false),
  }),
) {}

export class EditManualAttendanceDto extends createZodDto(
  z.strictObject({
    version: z.int().min(1),
    inTime: clock.nullable().optional(),
    outTime: clock.nullable().optional(),
    reason: z.string().trim().min(1).max(500).optional(),
  }),
) {}

export class ManualActionDto extends createZodDto(
  z.strictObject({ version: z.int().min(1), remarks: z.string().trim().max(500).optional() }),
) {}

export class ManualAttendanceListQueryDto extends createZodDto(
  z.object({
    ...paginationShape,
    status: z.enum(MANUAL_STATUSES).optional(),
    staffId: z.uuid().optional(),
    departmentId: z.uuid().optional(),
    from: day.optional(),
    to: day.optional(),
  }),
) {}

export class ManualContextQueryDto extends createZodDto(
  z.object({
    staffId: z.uuid(),
    date: day,
    inTime: clock.optional(),
    outTime: clock.optional(),
    excludeId: z.uuid().optional(),
  }),
) {}

const manualShape = {
  id: z.uuid(),
  staffId: z.uuid(),
  employeeNo: z.string(),
  staffName: z.string(),
  departmentName: z.string(),
  attendanceDate: z.string(),
  inTime: z.string().nullable(),
  outTime: z.string().nullable(),
  reason: z.string(),
  status: z.enum(MANUAL_STATUSES),
  createdBy: z.uuid().nullable(),
  submittedBy: z.uuid().nullable(),
  submittedAt: isoDate.nullable(),
  decidedBy: z.uuid().nullable(),
  decidedAt: isoDate.nullable(),
  decisionRemarks: z.string().nullable(),
  version: z.int(),
  createdAt: isoDate,
};
export class ManualAttendanceResponseDto extends responseDto(manualShape) {}
export class ManualAttendancePageResponseDto extends responseDto({
  items: z.array(z.object(manualShape)),
  ...pageMetaShape,
}) {}

export class ManualContextResponseDto extends responseDto({
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
  preview: z.enum(STATUSES).nullable(),
}) {}
