import { z } from 'zod';
import { pageMetaShape, paginationShape, responseDto } from '../../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../../shared/presentation/zod/zod-dto.js';

const day = z.iso.date();
const ref = z.uuid();
const text = (max: number) => z.string().trim().max(max).nullable();
const quantity = z.number().positive().max(1_000_000_000);
const version = z.int().min(1);
const moveLine = z.strictObject({ variantId: ref, qty: quantity, lotId: ref.nullable().default(null) });
const moveLines = z.array(moveLine).min(1).max(300);

export class DepartmentListQueryDto extends createZodDto(
  z.object({
    ...paginationShape,
    status: z.string().trim().max(30).optional(),
    from: day.optional(),
    to: day.optional(),
    q: z.string().trim().min(1).max(50).optional(),
    departmentId: ref.optional(),
    subStoreId: ref.optional(),
    mainStoreId: ref.optional(),
    supplierId: ref.optional(),
  }),
) {}

export class PostConsumptionDto extends createZodDto(
  z.strictObject({ departmentId: ref, consumedOn: day, note: text(500).default(null), lines: moveLines }),
) {}

export class CancelConsumptionDto extends createZodDto(
  z.strictObject({ version, reason: z.string().trim().min(1).max(500), on: day }),
) {}

export class OpenDepartmentReturnDto extends createZodDto(
  z.strictObject({
    departmentId: ref,
    subStoreId: ref,
    returnDate: day,
    reason: text(500).default(null),
    lines: moveLines,
  }),
) {}

export class DecideDepartmentReturnDto extends createZodDto(
  z.strictObject({ version, decision: z.enum(['receive', 'cancel']), on: day.nullable().default(null) }),
) {}

export class RequestCountDto extends createZodDto(
  z.strictObject({
    departmentId: ref,
    countedOn: day,
    reason: z.string().trim().min(1).max(500),
    lines: z
      .array(z.strictObject({ variantId: ref, lotId: ref, physicalQty: z.number().min(0).max(1_000_000_000) }))
      .min(1)
      .max(300),
  }),
) {}

export class DecideCountDto extends createZodDto(
  z.strictObject({ version, decision: z.enum(['approve', 'reject', 'cancel']), remarks: text(500).default(null) }),
) {}

export class DraftSupplierReturnDto extends createZodDto(
  z.strictObject({
    mainStoreId: ref,
    supplierId: ref,
    returnDate: day,
    reason: z.string().trim().min(1).max(500),
    lines: moveLines,
  }),
) {}

export class EditSupplierReturnDto extends createZodDto(
  z.strictObject({
    version,
    returnDate: day.optional(),
    reason: z.string().trim().min(1).max(500).optional(),
    lines: moveLines.optional(),
  }),
) {}

export class SettleSupplierReturnDto extends createZodDto(
  z.strictObject({
    version,
    on: day,
    lines: z
      .array(
        z.strictObject({
          receivedQty: z.number().min(0).max(1_000_000_000),
          replacementVariantId: ref.nullable().default(null),
          batchNo: text(50).default(null),
          expiryDate: day.nullable().default(null),
        }),
      )
      .min(1)
      .max(300),
  }),
) {}

export class SentReturnResponseDto extends responseDto({
  gatePassNumber: z.string(),
  voucherNumber: z.string().nullable(),
}) {}
export class VoucherResultResponseDto extends responseDto({ voucherNumber: z.string().nullable() }) {}

export class IssueGatePassDto extends createZodDto(
  z.strictObject({
    passDate: day,
    kind: z.enum(['maintenance', 'other']),
    reference: text(100).default(null),
    partyName: z.string().trim().min(1).max(200),
    note: text(500).default(null),
  }),
) {}

const summaryShape = {
  id: z.uuid(),
  number: z.string(),
  date: z.string(),
  status: z.string(),
  partyName: z.string(),
  storeName: z.string().nullable(),
  version: z.int(),
};
export class DocumentPageResponseDto extends responseDto({
  items: z.array(z.object(summaryShape)),
  ...pageMetaShape,
}) {}
export class DocumentResponseDto extends responseDto({
  ...summaryShape,
  kind: z.string(),
  note: z.string().nullable(),
  fields: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
  lines: z.array(
    z.object({
      variantId: z.uuid(),
      variantName: z.string(),
      code: z.string().nullable(),
      itemName: z.string(),
      unit: z.string(),
      qty: z.number(),
      lotId: z.uuid().nullable(),
      batchNo: z.string().nullable(),
      expiryDate: z.string().nullable(),
      systemQty: z.number().optional(),
      physicalQty: z.number().optional(),
      adjustQty: z.number().nullable().optional(),
      unitCost: z.number().nullable().optional(),
      receivedQty: z.number().nullable().optional(),
      replacementName: z.string().nullable().optional(),
    }),
  ),
  parts: z.array(
    z.object({
      variantId: z.uuid(),
      variantName: z.string(),
      code: z.string().nullable(),
      itemName: z.string(),
      unit: z.string(),
      batchNo: z.string().nullable(),
      expiryDate: z.string().nullable(),
      qty: z.number(),
      unitCost: z.number(),
    }),
  ),
  value: z.number(),
}) {}
