import { z } from 'zod';
import { pageMetaShape, paginationShape, responseDto } from '../../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../../shared/presentation/zod/zod-dto.js';

const day = z.iso.date();
const ref = z.uuid();
const version = z.int().min(1);
const units = z.int().min(1).max(10_000_000);
const money = z.number().min(0).max(1_000_000_000);
const optionalText = (max: number) => z.string().trim().max(max).nullable();

export class PharmacyPayDto extends createZodDto(
  z.strictObject({
    supplierId: ref,
    paidOn: day,
    method: z.enum(['cash', 'bank']),
    bankAccountId: ref.nullable().default(null),
    reference: optionalText(100).default(null),
    remarks: optionalText(1000).default(null),
    lines: z
      .array(z.strictObject({ receiveId: ref, amount: z.number().positive().max(1_000_000_000) }))
      .min(1)
      .max(300),
  }),
) {}
export class PharmacyPaidResponseDto extends responseDto({
  id: z.uuid(),
  number: z.string(),
  voucherNumber: z.string().nullable(),
}) {}
export class PharmacyDuesQueryDto extends createZodDto(z.object({ supplierId: ref })) {}
export class PharmacyDuesResponseDto extends responseDto({
  items: z.array(
    z.object({
      receiveId: z.uuid(),
      number: z.string(),
      receivedOn: z.string(),
      outletName: z.string(),
      supplierInvoiceNo: z.string().nullable(),
      total: z.number(),
      paid: z.number(),
      due: z.number(),
    }),
  ),
}) {}
export class PharmacyPaymentListQueryDto extends createZodDto(
  z.object({ ...paginationShape, supplierId: ref.optional(), from: day.optional(), to: day.optional() }),
) {}
const paymentShape = {
  id: z.uuid(),
  number: z.string(),
  supplierId: z.uuid(),
  supplierName: z.string(),
  paidOn: z.string(),
  method: z.string(),
  reference: z.string().nullable(),
  total: z.number(),
  voucherNumber: z.string().nullable(),
};
export class PharmacyPaymentPageResponseDto extends responseDto({
  items: z.array(z.object(paymentShape)),
  ...pageMetaShape,
}) {}
export class PharmacyPaymentResponseDto extends responseDto({
  ...paymentShape,
  supplierAddress: z.string().nullable(),
  bankAccountId: z.uuid().nullable(),
  remarks: z.string().nullable(),
  lines: z.array(
    z.object({
      receiveId: z.uuid(),
      receiveNumber: z.string(),
      receivedOn: z.string(),
      supplierInvoiceNo: z.string().nullable(),
      dueBefore: z.number(),
      amount: z.number(),
      dueAfter: z.number(),
    }),
  ),
}) {}

const returnLines = z
  .array(z.strictObject({ lotId: ref, qty: units }))
  .min(1)
  .max(300);
export class PharmacyCreateReturnDto extends createZodDto(
  z.strictObject({
    outletId: ref,
    supplierId: ref,
    returnDate: day,
    reason: z.string().trim().min(1).max(500),
    lines: returnLines,
  }),
) {}
export class PharmacyEditReturnDto extends createZodDto(
  z.strictObject({
    version,
    returnDate: day.optional(),
    reason: z.string().trim().min(1).max(500).optional(),
    lines: returnLines.optional(),
  }),
) {}
export class PharmacySettleReturnDto extends createZodDto(
  z.strictObject({
    version,
    on: day,
    lines: z
      .array(
        z.strictObject({
          productId: ref,
          qty: units,
          purchaseRate: money,
          saleRate: money,
          batchNo: optionalText(50).default(null),
          expiryDate: day,
        }),
      )
      .min(1)
      .max(300),
  }),
) {}
export class PharmacyCloseReturnDto extends createZodDto(
  z.strictObject({ version, reason: z.string().trim().min(1).max(500) }),
) {}
export class PharmacyReturnListQueryDto extends createZodDto(
  z.object({
    ...paginationShape,
    supplierId: ref.optional(),
    outletId: ref.optional(),
    status: z.string().trim().max(30).optional(),
  }),
) {}
export class PharmacySentResponseDto extends responseDto({ value: z.number(), voucherNumber: z.string().nullable() }) {}
export class PharmacySettledResponseDto extends responseDto({
  status: z.string(),
  voucherNumber: z.string().nullable(),
}) {}

const returnShape = {
  id: z.uuid(),
  number: z.string(),
  returnDate: z.string(),
  outletId: z.uuid(),
  outletName: z.string(),
  supplierId: z.uuid(),
  supplierName: z.string(),
  status: z.string(),
  value: z.number(),
  settledValue: z.number(),
  version: z.int(),
};
const productRefShape = {
  productId: z.uuid(),
  displayName: z.string(),
  genericName: z.string(),
  unitName: z.string().nullable(),
};
export class PharmacyReturnPageResponseDto extends responseDto({
  items: z.array(z.object(returnShape)),
  ...pageMetaShape,
}) {}
export class PharmacyReturnResponseDto extends responseDto({
  ...returnShape,
  reason: z.string(),
  closeReason: z.string().nullable(),
  sentVoucherNumber: z.string().nullable(),
  lines: z.array(
    z.object({
      ...productRefShape,
      lotId: z.uuid(),
      batchNo: z.string().nullable(),
      expiryDate: z.string(),
      qty: z.int(),
      unitCost: z.number().nullable(),
      value: z.number().nullable(),
    }),
  ),
  settlements: z.array(
    z.object({
      ...productRefShape,
      settledOn: z.string(),
      batchNo: z.string().nullable(),
      expiryDate: z.string(),
      qty: z.int(),
      purchaseRate: z.number(),
      value: z.number(),
      voucherNumber: z.string().nullable(),
    }),
  ),
}) {}
