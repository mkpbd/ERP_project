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

const METHODS = ['percentage', 'fixed', 'individual'] as const;
const percent = z.number().min(0).max(100);
const amount = z.number().min(0).max(10_000_000);
const year = z.coerce.number().int().min(2000).max(2100);
const month = z.coerce.number().int().min(1).max(12);

const policyFields = {
  name: z.string().trim().min(1).max(100),
  basicPercentOfGross: percent,
  houseRentPercentOfBasic: percent,
  medicalPercentOfBasic: percent,
  pfPercentOfBasic: percent,
  cpfPercentOfBasic: percent,
  conveyanceCap: amount,
};
export class CreateSalaryPolicyDto extends createZodDto(
  z.strictObject({
    ...policyFields,
    pfPercentOfBasic: percent.default(0),
    cpfPercentOfBasic: percent.default(0),
    conveyanceCap: amount.default(2500),
  }),
) {}
export class UpdateSalaryPolicyDto extends createZodDto(updateSchema(policyFields)) {}
export class SalaryPolicyResponseDto extends responseDto(recordResponseShape(policyFields)) {}

const cycleFields = { name: z.string().trim().min(1).max(100) };
export class CreateReviewCycleDto extends createZodDto(z.strictObject(cycleFields)) {}
export class UpdateReviewCycleDto extends createZodDto(updateSchema(cycleFields)) {}
export class ReviewCycleResponseDto extends responseDto(recordResponseShape(cycleFields)) {}

const settingsFields = {
  policyId: z.uuid(),
  pfEnabled: z.boolean(),
  specialAllowance: amount,
  otherFixed: amount,
  overtimeRatePerHour: amount,
  taxableAmount: amount,
  incrementMethod: z.enum(METHODS),
  incrementPercent: percent,
  fixedIncrement: amount,
  reviewCycleId: z.uuid().nullable(),
};
const gross = z.number().positive().max(10_000_000);

export class SetSalaryDto extends createZodDto(
  z.strictObject({
    gross,
    ...settingsFields,
    specialAllowance: amount.default(0),
    otherFixed: amount.default(0),
    overtimeRatePerHour: amount.default(0),
    taxableAmount: amount.default(0),
    incrementMethod: z.enum(METHODS).default('percentage'),
    incrementPercent: percent.default(10),
    fixedIncrement: amount.default(0),
    reviewCycleId: z.uuid().nullable().default(null),
  }),
) {}

export class ReviseSalaryDto extends createZodDto(
  z
    .strictObject(settingsFields)
    .partial()
    .extend({ version: z.int().min(1), gross: gross.optional() })
    .refine((value) => Object.keys(value).length > 1, 'Change at least one field'),
) {}

export class StaffIdParamDto extends createZodDto(z.strictObject({ staffId: z.uuid() })) {}

export class SalaryListQueryDto extends createZodDto(
  z.object({
    ...paginationShape,
    departmentId: z.uuid().optional(),
    policyId: z.uuid().optional(),
    q: z.string().trim().min(1).max(100).optional(),
  }),
) {}

const breakdown = {
  gross: z.number(),
  basic: z.number(),
  houseRent: z.number(),
  medical: z.number(),
  conveyance: z.number(),
  otherAllowance: z.number(),
  pf: z.number(),
  cpf: z.number(),
};
const salaryShape = {
  staffId: z.uuid(),
  employeeNo: z.string(),
  fullName: z.string(),
  department: z.string(),
  designation: z.string(),
  joiningDate: z.string(),
  ...breakdown,
  policyId: z.uuid(),
  policyName: z.string(),
  pfEnabled: z.boolean(),
  specialAllowance: z.number(),
  otherFixed: z.number(),
  overtimeRatePerHour: z.number(),
  taxableAmount: z.number(),
  incrementMethod: z.enum(METHODS),
  incrementPercent: z.number(),
  fixedIncrement: z.number(),
  reviewCycleId: z.uuid().nullable(),
  reviewCycleName: z.string().nullable(),
  version: z.int(),
  updatedAt: isoDate,
};
export class SalaryResponseDto extends responseDto(salaryShape) {}
export class SalaryPageResponseDto extends responseDto({ items: z.array(z.object(salaryShape)), ...pageMetaShape }) {}

export class PayPeriodDto extends createZodDto(z.strictObject({ year, month })) {}
export class PayPeriodQueryDto extends createZodDto(z.object({ year, month })) {}

export class ApplyIncrementsDto extends createZodDto(
  z.strictObject({
    year,
    month,
    entries: z
      .array(
        z.strictObject({
          staffId: z.uuid(),
          amount: z.number().positive().max(10_000_000).optional(),
          arrear: amount.optional(),
        }),
      )
      .min(1)
      .max(1000),
  }),
) {}

export class IncrementListQueryDto extends createZodDto(
  z.object({
    year: year.optional(),
    month: month.optional(),
    staffId: z.uuid().optional(),
    departmentId: z.uuid().optional(),
    status: z.enum(['pending', 'committed']).optional(),
  }),
) {}

export class IncrementResponseDto extends responseDto({
  id: z.uuid(),
  staffId: z.uuid(),
  employeeNo: z.string(),
  fullName: z.string(),
  department: z.string(),
  designation: z.string(),
  year: z.int(),
  month: z.int(),
  method: z.enum(METHODS),
  amount: z.number(),
  arrear: z.number(),
  before: z.object({ ...breakdown, policyId: z.uuid() }),
  status: z.enum(['pending', 'committed']),
  createdAt: isoDate,
  committedAt: isoDate.nullable(),
}) {}

export class IncrementCandidateResponseDto extends responseDto({
  staffId: z.uuid(),
  employeeNo: z.string(),
  fullName: z.string(),
  department: z.string(),
  designation: z.string(),
  joiningDate: z.string(),
  gross: z.number(),
  method: z.enum(METHODS),
  amountDue: z.number().nullable(),
  arrear: z.number().nullable(),
  applied: z.boolean(),
}) {}

export class CountResponseDto extends responseDto({
  applied: z.int().optional(),
  committed: z.int().optional(),
  reversed: z.int().optional(),
}) {}
