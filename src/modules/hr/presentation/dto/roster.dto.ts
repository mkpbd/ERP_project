import { z } from 'zod';
import {
  isoDate,
  recordResponseShape,
  responseDto,
  updateSchema,
} from '../../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../../shared/presentation/zod/zod-dto.js';

const day = z.iso.date();
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected a time HH:mm (24-hour)');
const text = (max: number) => z.string().trim().max(max).nullable();

const shiftTypeFields = {
  departmentId: z.uuid(),
  code: z.string().trim().min(1).max(10),
  name: z.string().trim().min(1).max(100),
  startTime: clock,
  endTime: clock,
};
export class CreateShiftTypeDto extends createZodDto(
  z
    .strictObject(shiftTypeFields)
    .refine((value) => value.startTime !== value.endTime, { message: 'Start and end must differ', path: ['endTime'] }),
) {}
export class UpdateShiftTypeDto extends createZodDto(updateSchema(shiftTypeFields)) {}
export class ShiftTypeFilterDto extends createZodDto(z.object({ departmentId: z.uuid().optional() })) {}
export class ShiftTypeResponseDto extends responseDto(
  recordResponseShape({
    departmentId: z.uuid(),
    code: z.string(),
    name: z.string(),
    startTime: z.string(),
    endTime: z.string(),
  }),
) {}

const exchangeFields = {
  staffId: z.uuid(),
  exchangeWithStaffId: z.uuid(),
  dateFrom: day,
  dateTo: day,
  shift: text(50),
  remarks: text(500),
};
export class CreateDutyExchangeDto extends createZodDto(
  z.strictObject({
    ...exchangeFields,
    shift: exchangeFields.shift.default(null),
    remarks: exchangeFields.remarks.default(null),
  }),
) {}
export class UpdateDutyExchangeDto extends createZodDto(updateSchema(exchangeFields)) {}
export class StaffPeriodFilterDto extends createZodDto(
  z.object({ staffId: z.uuid().optional(), from: day.optional(), to: day.optional() }),
) {}
export class DutyExchangeResponseDto extends responseDto(
  recordResponseShape({ ...exchangeFields, dateFrom: z.string(), dateTo: z.string() }),
) {}

const extraDutyFields = {
  staffId: z.uuid(),
  dutyFrom: day,
  dutyTo: day,
  compensationFrom: day.nullable(),
  compensationTo: day.nullable(),
  remarks: text(500),
};
export class CreateExtraDutyDto extends createZodDto(
  z.strictObject({
    ...extraDutyFields,
    compensationFrom: extraDutyFields.compensationFrom.default(null),
    compensationTo: extraDutyFields.compensationTo.default(null),
    remarks: extraDutyFields.remarks.default(null),
  }),
) {}
export class UpdateExtraDutyDto extends createZodDto(updateSchema(extraDutyFields)) {}
export class ExtraDutyResponseDto extends responseDto(
  recordResponseShape({
    ...extraDutyFields,
    dutyFrom: z.string(),
    dutyTo: z.string(),
    compensationFrom: z.string().nullable(),
    compensationTo: z.string().nullable(),
  }),
) {}

const monthShape = {
  departmentId: z.uuid(),
  subDepartmentId: z.uuid(),
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
};
export class RosterMonthQueryDto extends createZodDto(z.object(monthShape)) {}

export class SaveRosterDto extends createZodDto(
  z.strictObject({
    departmentId: z.uuid(),
    subDepartmentId: z.uuid(),
    year: z.int().min(2000).max(2100),
    month: z.int().min(1).max(12),
    entries: z
      .array(
        z.strictObject({
          staffId: z.uuid(),
          date: day,
          shifts: z
            .array(z.strictObject({ shiftTypeId: z.uuid(), remarks: text(500).default(null) }))
            .max(5)
            .default([]),
          dayOff: z.boolean().default(false),
          dayOffRemarks: text(500).default(null),
          /** The `version` of the cell when it was loaded ("" for an empty cell). */
          expectedVersion: z.string().max(64),
        }),
      )
      .min(1)
      .max(2000),
  }),
) {}

export class DateRangeQueryDto extends createZodDto(z.object({ from: day, to: day })) {}

const shiftView = z.object({
  id: z.uuid(),
  shiftTypeId: z.uuid(),
  code: z.string(),
  startAt: isoDate,
  endAt: isoDate,
  remarks: z.string().nullable(),
});
const dayShape = {
  staffId: z.uuid(),
  date: z.string(),
  shifts: z.array(shiftView),
  dayOff: z.boolean(),
  dayOffRemarks: z.string().nullable(),
  version: z.string(),
};
export class RosterDayResponseDto extends responseDto(dayShape) {}

export class RosterMonthResponseDto extends responseDto({
  departmentId: z.uuid(),
  subDepartmentId: z.uuid(),
  year: z.int(),
  month: z.int(),
  staff: z.array(
    z.object({
      id: z.uuid(),
      employeeNo: z.string(),
      fullName: z.string(),
      designationName: z.string(),
      inScope: z.boolean(),
    }),
  ),
  shiftTypes: z.array(
    z.object({ id: z.uuid(), code: z.string(), name: z.string(), startTime: z.string(), endTime: z.string() }),
  ),
  days: z.array(z.object(dayShape)),
  govtHolidays: z.array(z.object({ date: z.string(), name: z.string() })),
}) {}

export class SaveRosterResponseDto extends responseDto({
  saved: z.int(),
  failed: z.int(),
  results: z.array(
    z.object({
      staffId: z.uuid(),
      date: z.string(),
      status: z.enum(['saved', 'unchanged', 'invalid', 'conflict']),
      errors: z.array(z.string()),
      current: z.object(dayShape),
    }),
  ),
}) {}
