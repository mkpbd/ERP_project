import { z } from 'zod';
import { recordResponseShape, responseDto, updateSchema } from '../../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../../shared/presentation/zod/zod-dto.js';

const day = z.iso.date();
const text = (max: number) => z.string().trim().max(max).nullable();
const year = z.int().min(2000).max(2100);
const month = z.int().min(1).max(12);
const queryYear = z.coerce.number().int().min(2000).max(2100);
const queryMonth = z.coerce.number().int().min(1).max(12);

const bonusFields = {
  festivalId: z.uuid(),
  payYear: year,
  payMonth: month,
  percentOfBasic: z.number().positive().max(100),
  joinedBy: day,
  payWithSalary: z.boolean(),
  dateFrom: day.nullable(),
  dateTo: day.nullable(),
};
export class CreateFestivalBonusDto extends createZodDto(
  z
    .strictObject({
      ...bonusFields,
      payWithSalary: z.boolean().default(false),
      dateFrom: day.nullable().default(null),
      dateTo: day.nullable().default(null),
    })
    .refine((value) => !value.dateFrom || !value.dateTo || value.dateTo >= value.dateFrom, {
      message: 'The end date is before the start date',
      path: ['dateTo'],
    }),
) {}
export class UpdateFestivalBonusDto extends createZodDto(updateSchema(bonusFields)) {}
export class FestivalBonusFilterDto extends createZodDto(
  z.object({ festivalId: z.uuid().optional(), payYear: queryYear.optional() }),
) {}
export class FestivalBonusResponseDto extends responseDto(
  recordResponseShape({
    ...bonusFields,
    joinedBy: z.string(),
    dateFrom: z.string().nullable(),
    dateTo: z.string().nullable(),
  }),
) {}

const bonusLineShape = {
  staffId: z.uuid(),
  employeeNo: z.string(),
  fullName: z.string(),
  departmentId: z.uuid(),
  department: z.string(),
  designation: z.string(),
  joiningDate: z.string(),
  paymentMode: z.string().nullable(),
  bankAccountNo: z.string().nullable(),
  gross: z.number(),
  basic: z.number(),
  amount: z.number(),
};
export class FestivalBonusSheetResponseDto extends responseDto({
  schedule: z.object({
    id: z.uuid(),
    festivalId: z.uuid(),
    festivalName: z.string(),
    payYear: z.int(),
    payMonth: z.int(),
    percentOfBasic: z.number(),
    joinedBy: z.string(),
    payWithSalary: z.boolean(),
  }),
  status: z.enum(['approved', 'committed']).nullable(),
  lines: z.array(z.object(bonusLineShape)),
}) {}
export class SheetResultResponseDto extends responseDto({ lines: z.int(), amount: z.number() }) {}

export class EncashmentPeriodParamDto extends createZodDto(z.strictObject({ year: queryYear, month: queryMonth })) {}
export class EncashmentOptionsDto extends createZodDto(
  z.object({ yearlyLeaveDays: z.coerce.number().int().min(1).max(60).default(24) }),
) {}
export class EncashmentApproveDto extends createZodDto(
  z.strictObject({ yearlyLeaveDays: z.int().min(1).max(60).default(24) }),
) {}
export class LeaveEncashmentResponseDto extends responseDto({
  payYear: z.int(),
  payMonth: z.int(),
  lines: z.array(
    z.object({
      staffId: z.uuid(),
      employeeNo: z.string(),
      fullName: z.string(),
      departmentId: z.uuid(),
      department: z.string(),
      designation: z.string(),
      joiningDate: z.string(),
      paymentMode: z.string().nullable(),
      gross: z.number(),
      entitledDays: z.number(),
      takenDays: z.int(),
      remainingDays: z.number(),
      perDay: z.number(),
      amount: z.number(),
    }),
  ),
}) {}
export class RemovedResponseDto extends responseDto({ removed: z.int() }) {}

const PF_TYPES = ['opening', 'contribution', 'interest', 'withdrawal', 'settlement', 'adjustment'] as const;
const pfFields = {
  staffId: z.uuid(),
  entryDate: day,
  type: z.enum(PF_TYPES),
  credit: z.number().min(0).max(10_000_000),
  debit: z.number().min(0).max(10_000_000),
  remarks: text(500),
};
const oneSide = (value: { credit: number; debit: number }) => value.credit > 0 !== value.debit > 0;
export class CreatePfEntryDto extends createZodDto(
  z
    .strictObject({
      ...pfFields,
      credit: pfFields.credit.default(0),
      debit: pfFields.debit.default(0),
      remarks: pfFields.remarks.default(null),
    })
    .refine(oneSide, { message: 'Enter either a credit or a debit', path: ['credit'] }),
) {}
export class UpdatePfEntryDto extends createZodDto(updateSchema(pfFields)) {}
export class LedgerFilterDto extends createZodDto(
  z.object({ staffId: z.uuid().optional(), from: day.optional(), to: day.optional() }),
) {}
export class PfEntryResponseDto extends responseDto(recordResponseShape({ ...pfFields, entryDate: z.string() })) {}

const dueFields = {
  staffId: z.uuid(),
  serviceUnitId: z.uuid().nullable(),
  entryDate: day,
  particulars: z.string().trim().min(1).max(300),
  debit: z.number().min(0).max(10_000_000),
  credit: z.number().min(0).max(10_000_000),
  reference: text(100),
};
export class CreateStaffDueDto extends createZodDto(
  z
    .strictObject({
      ...dueFields,
      serviceUnitId: z.uuid().nullable().default(null),
      debit: dueFields.debit.default(0),
      credit: dueFields.credit.default(0),
      reference: dueFields.reference.default(null),
    })
    .refine(oneSide, { message: 'Enter either what is owed (debit) or what was paid (credit)', path: ['debit'] }),
) {}
export class UpdateStaffDueDto extends createZodDto(updateSchema(dueFields)) {}
export class StaffDueFilterDto extends createZodDto(
  z.object({
    staffId: z.uuid().optional(),
    serviceUnitId: z.uuid().optional(),
    from: day.optional(),
    to: day.optional(),
  }),
) {}
export class StaffDueResponseDto extends responseDto(recordResponseShape({ ...dueFields, entryDate: z.string() })) {}

export class StatementQueryDto extends createZodDto(
  z.object({ from: day, to: day, staffId: z.uuid().optional(), serviceUnitId: z.uuid().optional() }),
) {}
export class StatementResponseDto extends responseDto({
  opening: z.number(),
  rows: z.array(
    z.object({ date: z.string(), description: z.string(), credit: z.number(), debit: z.number(), balance: z.number() }),
  ),
  closing: z.number(),
}) {}
