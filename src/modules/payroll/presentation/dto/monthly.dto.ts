import { z } from 'zod';
import {
  isoDate,
  recordResponseShape,
  responseDto,
  updateSchema,
} from '../../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../../shared/presentation/zod/zod-dto.js';

const day = z.iso.date();
const text = (max: number) => z.string().trim().max(max).nullable();
const amount = z.number().min(0).max(10_000_000);
const year = z.int().min(2000).max(2100);
const month = z.int().min(1).max(12);
const queryYear = z.coerce.number().int().min(2000).max(2100);
const queryMonth = z.coerce.number().int().min(1).max(12);
const payPeriod = { staffId: z.uuid(), payYear: year, payMonth: month };

export class MonthlyInputFilterDto extends createZodDto(
  z.object({ staffId: z.uuid().optional(), payYear: queryYear.optional(), payMonth: queryMonth.optional() }),
) {}

const overtimeFields = {
  ...payPeriod,
  workYear: year,
  workMonth: month,
  days: z.int().min(0).max(31),
  hours: z.int().min(0).max(744),
  amount,
  remarks: text(500),
};
const someOvertime = (value: { hours?: number; amount?: number }) => (value.hours ?? 0) > 0 || (value.amount ?? 0) > 0;
export class CreateOvertimeDto extends createZodDto(
  z
    .strictObject({
      ...overtimeFields,
      days: overtimeFields.days.default(0),
      hours: overtimeFields.hours.default(0),
      amount: amount.default(0),
      remarks: overtimeFields.remarks.default(null),
    })
    .refine(someOvertime, { message: 'Enter hours, an amount or both', path: ['hours'] }),
) {}
export class UpdateOvertimeDto extends createZodDto(updateSchema(overtimeFields)) {}
export class OvertimeResponseDto extends responseDto(recordResponseShape(overtimeFields)) {}

const deductionFields = {
  ...payPeriod,
  lwpDays: z.number().min(0).max(31),
  lwpFrom: day.nullable(),
  lwpTo: day.nullable(),
  otherDeduction: amount,
  ait: amount,
  sm: amount,
  mobileBill: amount,
  foodBill: amount,
  loan: amount,
  advanceSalary: amount,
  cause: z.string().trim().min(1).max(500),
};
export class CreateDeductionDto extends createZodDto(
  z
    .strictObject({
      ...deductionFields,
      lwpDays: deductionFields.lwpDays.default(0),
      lwpFrom: day.nullable().default(null),
      lwpTo: day.nullable().default(null),
      otherDeduction: amount.default(0),
      ait: amount.default(0),
      sm: amount.default(0),
      mobileBill: amount.default(0),
      foodBill: amount.default(0),
      loan: amount.default(0),
      advanceSalary: amount.default(0),
    })
    .refine(
      (value) =>
        value.lwpDays === 0 || (value.lwpFrom !== null && value.lwpTo !== null && value.lwpTo >= value.lwpFrom),
      { message: 'Give the LWP from and to dates (to on or after from) when there are LWP days', path: ['lwpFrom'] },
    )
    .refine(
      (value) =>
        [
          value.lwpDays,
          value.otherDeduction,
          value.ait,
          value.sm,
          value.mobileBill,
          value.foodBill,
          value.loan,
          value.advanceSalary,
        ].some((entry) => entry > 0),
      { message: 'Enter at least one deduction', path: ['lwpDays'] },
    ),
) {}
export class UpdateDeductionDto extends createZodDto(updateSchema(deductionFields)) {}
export class DeductionResponseDto extends responseDto(
  recordResponseShape({ ...deductionFields, lwpFrom: z.string().nullable(), lwpTo: z.string().nullable() }),
) {}

const punishmentFields = {
  ...payPeriod,
  amount: z.number().positive().max(10_000_000),
  description: z.string().trim().min(1).max(500),
};
export class CreatePunishmentDto extends createZodDto(z.strictObject(punishmentFields)) {}
export class UpdatePunishmentDto extends createZodDto(updateSchema(punishmentFields)) {}
export class PunishmentResponseDto extends responseDto(recordResponseShape(punishmentFields)) {}

const arrearFields = { ...payPeriod, amount: z.number().positive().max(10_000_000), remarks: text(500) };
export class CreateArrearDto extends createZodDto(
  z.strictObject({ ...arrearFields, remarks: arrearFields.remarks.default(null) }),
) {}
export class UpdateArrearDto extends createZodDto(updateSchema(arrearFields)) {}
export class ArrearResponseDto extends responseDto(recordResponseShape(arrearFields)) {}

const allowanceFields = {
  ...payPeriod,
  otherAllowance: amount,
  specialAllowance: amount,
  salaryRefund: amount,
  refundComment: text(500),
  paidOn: day.nullable(),
};
export class CreateAllowancePaymentDto extends createZodDto(
  z
    .strictObject({
      ...allowanceFields,
      otherAllowance: amount.default(0),
      specialAllowance: amount.default(0),
      salaryRefund: amount.default(0),
      refundComment: allowanceFields.refundComment.default(null),
      paidOn: day.nullable().default(null),
    })
    .refine((value) => value.otherAllowance > 0 || value.specialAllowance > 0 || value.salaryRefund > 0, {
      message: 'Enter at least one amount',
      path: ['otherAllowance'],
    }),
) {}
export class UpdateAllowancePaymentDto extends createZodDto(updateSchema(allowanceFields)) {}
export class AllowancePaymentResponseDto extends responseDto(
  recordResponseShape({ ...allowanceFields, paidOn: z.string().nullable() }),
) {}

const paymentFields = {
  ...payPeriod,
  paidOn: day.nullable(),
  advancePaid: amount,
  salaryPaid: amount,
  paymentMode: z.string().trim().min(1).max(50),
};
export class CreateSalaryPaymentDto extends createZodDto(
  z.strictObject({
    ...paymentFields,
    paidOn: day.nullable().default(null),
    advancePaid: amount.default(0),
    salaryPaid: amount.default(0),
  }),
) {}
export class UpdateSalaryPaymentDto extends createZodDto(updateSchema(paymentFields)) {}
export class SalaryPaymentResponseDto extends responseDto(
  recordResponseShape({ ...paymentFields, paidOn: z.string().nullable() }),
) {}

const stopFields = {
  staffId: z.uuid(),
  stopYear: year,
  stopMonth: month,
  startYear: year.nullable(),
  startMonth: month.nullable(),
  stoppedAmount: amount,
  remarks: text(500),
};
export class CreateSalaryStopDto extends createZodDto(
  z
    .strictObject({
      ...stopFields,
      startYear: year.nullable().default(null),
      startMonth: month.nullable().default(null),
      stoppedAmount: amount.default(0),
      remarks: stopFields.remarks.default(null),
    })
    .refine(
      (value) =>
        (value.startYear === null) === (value.startMonth === null) &&
        (value.startYear === null || value.startYear * 12 + value.startMonth! >= value.stopYear * 12 + value.stopMonth),
      { message: 'Give both start year and month, not before the stop', path: ['startYear'] },
    ),
) {}
export class UpdateSalaryStopDto extends createZodDto(updateSchema(stopFields)) {}
export class SalaryStopFilterDto extends createZodDto(z.object({ staffId: z.uuid().optional() })) {}
export class SalaryStopResponseDto extends responseDto(recordResponseShape(stopFields)) {}

export class SheetPeriodParamDto extends createZodDto(z.strictObject({ year: queryYear, month: queryMonth })) {}
export class PayslipParamDto extends createZodDto(
  z.strictObject({ year: queryYear, month: queryMonth, staffId: z.uuid() }),
) {}
export class SheetQueryDto extends createZodDto(z.object({ departmentId: z.uuid().optional() })) {}

const lineShape = {
  staffId: z.uuid(),
  employeeNo: z.string(),
  fullName: z.string(),
  departmentId: z.uuid(),
  department: z.string(),
  designation: z.string(),
  joiningDate: z.string(),
  paymentMode: z.string().nullable(),
  bankAccountNo: z.string().nullable(),
  basic: z.number(),
  houseRent: z.number(),
  medical: z.number(),
  conveyance: z.number(),
  otherAllowance: z.number(),
  gross: z.number(),
  allowance: z.number(),
  specialAllowance: z.number(),
  overtime: z.number(),
  festivalBonus: z.number(),
  arrear: z.number(),
  totalPayable: z.number(),
  pf: z.number(),
  incomeTax: z.number(),
  lwpDays: z.number(),
  lwp: z.number(),
  punishment: z.number(),
  totalDeduction: z.number(),
  netPayable: z.number(),
  advance: z.number(),
  paid: z.number(),
};
export class SalarySheetLineResponseDto extends responseDto(lineShape) {}
export class SalarySheetResponseDto extends responseDto({
  year: z.int(),
  month: z.int(),
  status: z.enum(['approved', 'committed']).nullable(),
  approvedAt: isoDate.nullable(),
  committedAt: isoDate.nullable(),
  lines: z.array(z.object(lineShape)),
}) {}
export class ApproveResultResponseDto extends responseDto({ lines: z.int(), netPayable: z.number() }) {}
