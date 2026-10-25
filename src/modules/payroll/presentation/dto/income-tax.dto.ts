import { z } from 'zod';
import { recordResponseShape, responseDto, updateSchema } from '../../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../../shared/presentation/zod/zod-dto.js';

const day = z.iso.date();
const amount = z.number().min(0).max(100_000_000);
const percent = z.number().min(0).max(100);
const queryYear = z.coerce.number().int().min(2000).max(2100);
const queryMonth = z.coerce.number().int().min(1).max(12);

const slabs = z
  .array(z.strictObject({ width: z.number().positive().max(100_000_000).nullable(), ratePercent: percent }))
  .min(1)
  .max(12)
  .refine((list) => list.every((slab, index) => (index === list.length - 1) === (slab.width === null)), {
    message: 'Every slab but the last needs a width; the last one has none (the rest of the income)',
  });

const taxYearFields = {
  label: z.string().trim().min(1).max(20),
  startsOn: day,
  endsOn: day,
  maleSlabs: slabs,
  femaleSlabs: slabs,
  maleExemptionCap: amount,
  femaleExemptionCap: amount,
  rebateOnTaxablePercent: percent,
  investmentAllowancePercent: percent,
  rebateOnInvestmentPercent: percent,
  rebateCap: amount,
  minimumMonthlyTax: amount,
  maleMinimumTaxGross: amount,
  femaleMinimumTaxGross: amount,
  expectedBonusBasics: z.number().min(0).max(12),
};
export class CreateTaxYearDto extends createZodDto(
  z
    .strictObject({
      ...taxYearFields,
      rebateOnTaxablePercent: percent.default(3),
      investmentAllowancePercent: percent.default(20),
      rebateOnInvestmentPercent: percent.default(15),
      rebateCap: amount.default(1_000_000),
      minimumMonthlyTax: amount.default(417),
      expectedBonusBasics: taxYearFields.expectedBonusBasics.default(2.5),
    })
    .refine((value) => value.endsOn > value.startsOn, { message: 'The end is not after the start', path: ['endsOn'] }),
) {}
export class UpdateTaxYearDto extends createZodDto(updateSchema(taxYearFields)) {}
export class TaxYearResponseDto extends responseDto(
  recordResponseShape({ ...taxYearFields, startsOn: z.string(), endsOn: z.string() }),
) {}

export class TaxPeriodParamDto extends createZodDto(z.strictObject({ year: queryYear, month: queryMonth })) {}
export class TaxOverrideParamDto extends createZodDto(
  z.strictObject({ year: queryYear, month: queryMonth, staffId: z.uuid() }),
) {}
export class SetIncomeTaxDto extends createZodDto(
  z.strictObject({ monthlyTax: amount.nullable(), remarks: z.string().trim().max(500).nullable().default(null) }),
) {}
export class ComputeResultResponseDto extends responseDto({ people: z.int(), monthlyTax: z.number() }) {}
export class IncomeTaxDeductionResponseDto extends responseDto({
  staffId: z.uuid(),
  employeeNo: z.string(),
  fullName: z.string(),
  department: z.string(),
  payYear: z.int(),
  payMonth: z.int(),
  taxYearId: z.uuid(),
  taxableIncome: z.number().nullable(),
  yearlyTax: z.number().nullable(),
  monthlyTax: z.number(),
  source: z.enum(['computed', 'manual']),
  remarks: z.string().nullable(),
}) {}

export class CertificateParamDto extends createZodDto(z.strictObject({ taxYearId: z.uuid() })) {}
export class CertificateQueryDto extends createZodDto(z.object({ staffId: z.uuid().optional() })) {}
const money = z.number();
export class TaxCertificateResponseDto extends responseDto({
  staff: z.object({ id: z.uuid(), employeeNo: z.string(), fullName: z.string(), department: z.string() }),
  taxYear: z.object({ id: z.uuid(), label: z.string(), startsOn: z.string(), endsOn: z.string() }),
  certificate: z.object({
    monthsPaid: z.int(),
    monthsAhead: z.int(),
    received: z.record(z.string(), money),
    projected: z.object({ salary: money, bonus: money, employerPf: money }),
    totalIncome: money,
    exemption: money,
    taxableIncome: money,
    bands: z.array(z.object({ amount: money, ratePercent: money, tax: money })),
    grossTax: money,
    rebate: money,
    netTax: money,
    taxPaid: money,
    taxDue: money,
    monthlyTax: money,
  }),
}) {}
