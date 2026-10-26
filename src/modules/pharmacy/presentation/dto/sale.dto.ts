import { z } from 'zod';
import { pageMetaShape, paginationShape, responseDto } from '../../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../../shared/presentation/zod/zod-dto.js';

const day = z.iso.date();
const ref = z.uuid();
const percent = z.number().min(0).max(100).multipleOf(0.01);
const money = z.number().min(0).max(1_000_000_000);
const method = z.enum(['cash', 'card', 'mobile']);
const optionalText = (max: number) => z.string().trim().max(max).nullable();
const saleLines = z
  .array(z.strictObject({ productId: ref, qty: z.int().min(1).max(10_000_000), lotId: ref.nullable().default(null) }))
  .min(1)
  .max(300);

export class PharmacyDiscountPolicyDto extends createZodDto(
  z.strictObject({ allowedByDefault: z.boolean(), opdPercent: percent, ipdPercent: percent.nullable() }),
) {}
export class PharmacyDiscountPolicyResponseDto extends responseDto({
  allowedByDefault: z.boolean(),
  opdPercent: z.number(),
  ipdPercent: z.number().nullable(),
}) {}

export class PharmacyQuoteDto extends createZodDto(z.strictObject({ outletId: ref, on: day, lines: saleLines })) {}
export class PharmacySaleDto extends createZodDto(
  z.strictObject({
    outletId: ref,
    soldOn: day,
    customerName: optionalText(150).default(null),
    mobileNo: optionalText(20).default(null),
    loyalMemberId: ref.nullable().default(null),
    lines: saleLines,
    method: method.default('cash'),
    reference: optionalText(100).default(null),
    tendered: money,
  }),
) {}
export class PharmacyCancelSaleDto extends createZodDto(
  z.strictObject({ version: z.int().min(1), on: day, reason: z.string().trim().min(1).max(500) }),
) {}
export class PharmacyCollectDto extends createZodDto(
  z.strictObject({
    collectedOn: day,
    amount: z.number().positive().max(1_000_000_000),
    method: method.default('cash'),
    reference: optionalText(100).default(null),
  }),
) {}
export class PharmacySaleListQueryDto extends createZodDto(
  z.object({
    ...paginationShape,
    outletId: ref.optional(),
    loyalMemberId: ref.optional(),
    status: z.string().trim().max(30).optional(),
    from: day.optional(),
    to: day.optional(),
    q: z.string().trim().min(1).max(100).optional(),
  }),
) {}

const productRefShape = {
  productId: z.uuid(),
  displayName: z.string(),
  genericName: z.string(),
  unitName: z.string().nullable(),
};
const lineShape = {
  ...productRefShape,
  lotId: z.uuid(),
  batchNo: z.string().nullable(),
  expiryDate: z.string(),
  qty: z.int(),
  saleRate: z.number(),
  amount: z.number(),
  discountPercent: z.number(),
  discount: z.number(),
  total: z.number(),
};
export class PharmacyQuoteResponseDto extends responseDto({
  lines: z.array(z.object(lineShape)),
  amount: z.number(),
  discount: z.number(),
  total: z.number(),
}) {}
export class PharmacySoldResponseDto extends responseDto({
  id: z.uuid(),
  number: z.string(),
  total: z.number(),
  change: z.number(),
  due: z.number(),
  voucherNumber: z.string().nullable(),
}) {}
export class PharmacyCollectedResponseDto extends responseDto({
  id: z.uuid(),
  number: z.string(),
  voucherNumber: z.string().nullable(),
}) {}
const saleShape = {
  id: z.uuid(),
  number: z.string(),
  soldOn: z.string(),
  outletId: z.uuid(),
  outletName: z.string(),
  customerName: z.string().nullable(),
  mobileNo: z.string().nullable(),
  loyalMemberId: z.uuid().nullable(),
  loyalMemberName: z.string().nullable(),
  total: z.number(),
  paid: z.number(),
  due: z.number(),
  collected: z.number(),
  status: z.string(),
  version: z.int(),
};
export class PharmacySalePageResponseDto extends responseDto({
  items: z.array(z.object(saleShape)),
  ...pageMetaShape,
}) {}
export class PharmacySaleResponseDto extends responseDto({
  ...saleShape,
  amount: z.number(),
  discount: z.number(),
  method: z.string(),
  reference: z.string().nullable(),
  tendered: z.number(),
  change: z.number(),
  cancelReason: z.string().nullable(),
  cancelledOn: z.string().nullable(),
  voucherNumber: z.string().nullable(),
  soldBy: z.uuid().nullable(),
  lines: z.array(z.object(lineShape)),
}) {}
export class PharmacyMemberDuesResponseDto extends responseDto({
  loyalMemberId: z.uuid(),
  name: z.string(),
  contactNo: z.string(),
  due: z.number(),
  sales: z.array(
    z.object({
      saleId: z.uuid(),
      number: z.string(),
      soldOn: z.string(),
      total: z.number(),
      due: z.number(),
      collected: z.number(),
    }),
  ),
}) {}
