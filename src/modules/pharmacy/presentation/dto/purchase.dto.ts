import { z } from 'zod';
import { pageMetaShape, paginationShape, responseDto } from '../../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../../shared/presentation/zod/zod-dto.js';

const day = z.iso.date();
const ref = z.uuid();
const version = z.int().min(1);
const units = z.int().min(1).max(10_000_000);
const money = z.number().min(0).max(1_000_000_000);
const percent = z.number().min(0).max(100);
const optionalText = (max: number) => z.string().trim().max(max).nullable();

export class PharmacyVersionDto extends createZodDto(z.strictObject({ version })) {}
export class PharmacyVersionQueryDto extends createZodDto(z.object({ version: z.coerce.number().int().min(1) })) {}
export class PharmacyEndOrderDto extends createZodDto(
  z.strictObject({ version, reason: z.string().trim().min(1).max(500) }),
) {}
export class PharmacyCreatedDocumentResponseDto extends responseDto({ id: z.uuid(), number: z.string() }) {}
export class PharmacyPostedResponseDto extends responseDto({ voucherNumber: z.string().nullable() }) {}

export class PharmacyDocumentListQueryDto extends createZodDto(
  z.object({
    ...paginationShape,
    status: z.string().trim().max(30).optional(),
    from: day.optional(),
    to: day.optional(),
    outletId: ref.optional(),
    supplierId: ref.optional(),
    q: z.string().trim().min(1).max(100).optional(),
  }),
) {}

const orderHeader = { supplierId: ref, outletId: ref, orderDate: day, note: optionalText(1000) };
const orderLines = z
  .array(z.strictObject({ productId: ref, qty: units }))
  .min(1)
  .max(300);
export class PharmacyCreateOrderDto extends createZodDto(
  z.strictObject({ ...orderHeader, note: orderHeader.note.default(null), lines: orderLines }),
) {}
export class PharmacyEditOrderDto extends createZodDto(
  z.strictObject({
    version,
    supplierId: ref.optional(),
    outletId: ref.optional(),
    orderDate: day.optional(),
    note: optionalText(1000).optional(),
    lines: orderLines.optional(),
  }),
) {}

const orderSummaryShape = {
  id: z.uuid(),
  number: z.string(),
  orderDate: z.string(),
  supplierId: z.uuid(),
  supplierName: z.string(),
  outletId: z.uuid(),
  outletName: z.string(),
  status: z.string(),
  lineCount: z.int(),
  version: z.int(),
};
const productRefShape = {
  productId: z.uuid(),
  displayName: z.string(),
  genericName: z.string(),
  unitName: z.string().nullable(),
};
export class PharmacyOrderPageResponseDto extends responseDto({
  items: z.array(z.object(orderSummaryShape)),
  ...pageMetaShape,
}) {}
export class PharmacyOrderResponseDto extends responseDto({
  ...orderSummaryShape,
  note: z.string().nullable(),
  closeReason: z.string().nullable(),
  supplierAddress: z.string().nullable(),
  lines: z.array(z.object({ ...productRefShape, qty: z.int(), receivedQty: z.int() })),
}) {}

const receiveLine = z.strictObject({
  productId: ref,
  qty: units,
  purchaseRate: money,
  saleRate: money,
  discountPercent: percent.default(0),
  vatPercent: percent.default(0),
  batchNo: optionalText(50).default(null),
  expiryDate: day,
});
const receiveHeader = {
  outletId: ref,
  supplierId: ref,
  purchaseOrderId: ref.nullable(),
  receivedOn: day,
  supplierInvoiceNo: optionalText(50),
  supplierInvoiceDate: day.nullable(),
  challanNo: optionalText(50),
  remarks: optionalText(1000),
};
export class PharmacyCreateReceiveDto extends createZodDto(
  z.strictObject({
    ...receiveHeader,
    purchaseOrderId: receiveHeader.purchaseOrderId.default(null),
    supplierInvoiceNo: receiveHeader.supplierInvoiceNo.default(null),
    supplierInvoiceDate: receiveHeader.supplierInvoiceDate.default(null),
    challanNo: receiveHeader.challanNo.default(null),
    remarks: receiveHeader.remarks.default(null),
    lines: z.array(receiveLine).min(1).max(300),
  }),
) {}
export class PharmacyEditReceiveDto extends createZodDto(
  z.strictObject({
    version,
    ...Object.fromEntries(Object.entries(receiveHeader).map(([key, schema]) => [key, schema.optional()])),
    lines: z.array(receiveLine).min(1).max(300).optional(),
  }),
) {}

const amounts = { amount: z.number(), discount: z.number(), vat: z.number(), total: z.number() };
const receiveSummaryShape = {
  id: z.uuid(),
  number: z.string(),
  receivedOn: z.string(),
  outletId: z.uuid(),
  outletName: z.string(),
  supplierId: z.uuid(),
  supplierName: z.string(),
  purchaseOrderId: z.uuid().nullable(),
  purchaseOrderNumber: z.string().nullable(),
  supplierInvoiceNo: z.string().nullable(),
  challanNo: z.string().nullable(),
  status: z.string(),
  ...amounts,
  voucherNumber: z.string().nullable(),
  version: z.int(),
};
export class PharmacyReceivePageResponseDto extends responseDto({
  items: z.array(z.object(receiveSummaryShape)),
  ...pageMetaShape,
}) {}
export class PharmacyReceiveResponseDto extends responseDto({
  ...receiveSummaryShape,
  supplierAddress: z.string().nullable(),
  supplierInvoiceDate: z.string().nullable(),
  remarks: z.string().nullable(),
  createdBy: z.uuid().nullable(),
  postedBy: z.uuid().nullable(),
  postedAt: z.date().nullable(),
  lines: z.array(
    z.object({
      ...productRefShape,
      qty: z.int(),
      purchaseRate: z.number(),
      saleRate: z.number(),
      discountPercent: z.number(),
      vatPercent: z.number(),
      ...amounts,
      batchNo: z.string().nullable(),
      expiryDate: z.string(),
    }),
  ),
}) {}

export class PharmacyOpeningStockDto extends createZodDto(
  z.strictObject({
    outletId: ref,
    openedOn: day,
    note: optionalText(1000).default(null),
    lines: z
      .array(
        z.strictObject({
          productId: ref,
          qty: units,
          unitCost: money,
          saleRate: money,
          batchNo: optionalText(50).default(null),
          expiryDate: day,
        }),
      )
      .min(1)
      .max(300),
  }),
) {}

export class PharmacyStockQueryDto extends createZodDto(
  z.object({
    outletId: ref,
    productId: ref.optional(),
    q: z.string().trim().min(1).max(100).optional(),
    belowReorderOnly: z.enum(['true', 'false']).optional(),
    asOf: day.optional(),
  }),
) {}
export class PharmacyStockCardQueryDto extends createZodDto(
  z.object({ outletId: ref, productId: ref, from: day, to: day }),
) {}

export class PharmacyStockResponseDto extends responseDto({
  items: z.array(
    z.object({
      ...productRefShape,
      manufacturerName: z.string(),
      qty: z.int(),
      value: z.number(),
      saleValue: z.number(),
      reorderLevel: z.int(),
      belowReorder: z.boolean(),
      lots: z.array(
        z.object({
          lotId: z.uuid(),
          batchNo: z.string().nullable(),
          expiryDate: z.string(),
          saleRate: z.number(),
          qty: z.int(),
          value: z.number(),
        }),
      ),
    }),
  ),
}) {}
export class PharmacyStockCardResponseDto extends responseDto({
  ...productRefShape,
  opening: z.int(),
  rows: z.array(
    z.object({
      movedOn: z.string(),
      kind: z.string(),
      documentNumber: z.string(),
      batchNo: z.string().nullable(),
      expiryDate: z.string(),
      in: z.int(),
      out: z.int(),
      unitCost: z.number(),
      balance: z.int(),
    }),
  ),
  totalIn: z.int(),
  totalOut: z.int(),
  closing: z.int(),
}) {}
