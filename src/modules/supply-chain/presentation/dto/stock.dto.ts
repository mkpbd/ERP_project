import { z } from 'zod';
import { pageMetaShape, recordResponseShape, responseDto } from '../../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../../shared/presentation/zod/zod-dto.js';

const day = z.iso.date();
const ref = z.uuid();
const text = (max: number) => z.string().trim().max(max).nullable();
const quantity = z.number().positive().max(1_000_000_000);
const amount = z.number().min(0).max(1_000_000_000);
const percent = z.number().min(0).max(100);
const version = z.int().min(1);
const itemShape = {
  variantId: z.uuid(),
  variantName: z.string(),
  code: z.string().nullable(),
  itemName: z.string(),
  unit: z.string(),
};

const receiveLine = z.strictObject({
  variantId: ref,
  qty: quantity,
  rate: amount,
  discountPercent: percent.default(0),
  vatPercent: percent.default(0),
  aitPercent: percent.default(0),
  batchNo: text(50).default(null),
  expiryDate: day.nullable().default(null),
  warrantyNote: text(300).default(null),
});

export class CreateReceiveDto extends createZodDto(
  z.strictObject({
    mainStoreId: ref,
    supplierId: ref,
    purchaseOrderId: ref.nullable().default(null),
    receivedOn: day,
    supplierInvoiceNo: text(50).default(null),
    supplierInvoiceDate: day.nullable().default(null),
    challanNo: text(50).default(null),
    remarks: text(1000).default(null),
    lines: z.array(receiveLine).min(1).max(300),
  }),
) {}

export class EditReceiveDto extends createZodDto(
  z.strictObject({
    version,
    mainStoreId: ref.optional(),
    supplierId: ref.optional(),
    purchaseOrderId: ref.nullable().optional(),
    receivedOn: day.optional(),
    supplierInvoiceNo: text(50).optional(),
    supplierInvoiceDate: day.nullable().optional(),
    challanNo: text(50).optional(),
    remarks: text(1000).optional(),
    lines: z.array(receiveLine).min(1).max(300).optional(),
  }),
) {}

export class PostedReceiveResponseDto extends responseDto({ voucherNumber: z.string().nullable() }) {}

const receiveSummaryShape = {
  id: z.uuid(),
  number: z.string(),
  receivedOn: z.string(),
  mainStoreId: z.uuid(),
  mainStoreName: z.string(),
  supplierId: z.uuid(),
  supplierName: z.string(),
  purchaseOrderId: z.uuid().nullable(),
  purchaseOrderNumber: z.string().nullable(),
  supplierInvoiceNo: z.string().nullable(),
  challanNo: z.string().nullable(),
  status: z.string(),
  amount: z.number(),
  discount: z.number(),
  vat: z.number(),
  ait: z.number(),
  total: z.number(),
  voucherId: z.uuid().nullable(),
  voucherNumber: z.string().nullable(),
  version: z.int(),
};
export class ReceivePageResponseDto extends responseDto({
  items: z.array(z.object(receiveSummaryShape)),
  ...pageMetaShape,
}) {}
export class ReceiveResponseDto extends responseDto({
  ...receiveSummaryShape,
  supplierAddress: z.string().nullable(),
  supplierInvoiceDate: z.string().nullable(),
  remarks: z.string().nullable(),
  createdBy: z.uuid().nullable(),
  postedBy: z.uuid().nullable(),
  postedAt: z.date().nullable(),
  lines: z.array(
    z.object({
      ...itemShape,
      qty: z.number(),
      rate: z.number(),
      discountPercent: z.number(),
      vatPercent: z.number(),
      aitPercent: z.number(),
      amount: z.number(),
      discount: z.number(),
      vat: z.number(),
      ait: z.number(),
      total: z.number(),
      batchNo: z.string().nullable(),
      expiryDate: z.string().nullable(),
      warrantyNote: z.string().nullable(),
    }),
  ),
}) {}

/** One store: a main store or a sub-store. */
const storeShape = { mainStoreId: ref.optional(), subStoreId: ref.optional() };
const oneStore = (value: { mainStoreId?: string | undefined; subStoreId?: string | undefined }) =>
  (value.mainStoreId === undefined) !== (value.subStoreId === undefined);
const oneStoreIssue = { message: 'Give either a main store or a sub-store', path: ['mainStoreId'] };
const flag = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => value === 'true');

export class StockQueryDto extends createZodDto(
  z
    .object({
      ...storeShape,
      variantId: ref.optional(),
      groupId: ref.optional(),
      q: z.string().trim().min(1).max(100).optional(),
      belowReorderOnly: flag,
      includeEmpty: flag,
      asOf: day.optional(),
    })
    .refine(oneStore, oneStoreIssue),
) {}

export class StockCardQueryDto extends createZodDto(
  z.object({ ...storeShape, variantId: ref, from: day, to: day }).refine(oneStore, oneStoreIssue),
) {}

export class StockResponseDto extends responseDto({
  items: z.array(
    z.object({
      ...itemShape,
      groupName: z.string(),
      qty: z.number(),
      value: z.number(),
      reorderLevel: z.int(),
      belowReorder: z.boolean(),
      lots: z.array(
        z.object({
          lotId: z.uuid(),
          batchNo: z.string().nullable(),
          expiryDate: z.string().nullable(),
          qty: z.number(),
          value: z.number(),
        }),
      ),
    }),
  ),
}) {}

export class StockCardResponseDto extends responseDto({
  ...itemShape,
  opening: z.number(),
  rows: z.array(
    z.object({
      movedOn: z.string(),
      kind: z.string(),
      documentNumber: z.string(),
      batchNo: z.string().nullable(),
      expiryDate: z.string().nullable(),
      in: z.number(),
      out: z.number(),
      unitCost: z.number(),
      balance: z.number(),
    }),
  ),
  totalIn: z.number(),
  totalOut: z.number(),
  closing: z.number(),
}) {}

export class OpeningStockDto extends createZodDto(
  z
    .strictObject({
      ...storeShape,
      openedOn: day,
      note: text(500).default(null),
      lines: z
        .array(
          z.strictObject({
            variantId: ref,
            qty: quantity,
            unitCost: amount,
            batchNo: text(50).default(null),
            expiryDate: day.nullable().default(null),
          }),
        )
        .min(1)
        .max(300),
    })
    .refine(oneStore, oneStoreIssue),
) {}

export class CloseOrderDto extends createZodDto(
  z.strictObject({ version, reason: z.string().trim().min(1).max(500) }),
) {}

const faultFields = {
  purchaseOrderId: ref,
  variantId: ref,
  qty: quantity,
  description: z.string().trim().min(1).max(1000),
  notedOn: day,
};
export class CreateGrnFaultDto extends createZodDto(z.strictObject(faultFields)) {}
export class UpdateGrnFaultDto extends createZodDto(
  z.strictObject({
    qty: quantity.optional(),
    description: faultFields.description.optional(),
    notedOn: day.optional(),
  }),
) {}
export class GrnFaultFilterDto extends createZodDto(z.object({ purchaseOrderId: ref.optional() })) {}
export class GrnFaultResponseDto extends responseDto(recordResponseShape({ ...faultFields, notedOn: z.string() })) {}
