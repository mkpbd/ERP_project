import { z } from 'zod';
import { pageMetaShape, paginationShape, responseDto } from '../../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../../shared/presentation/zod/zod-dto.js';

const day = z.iso.date();
const ref = z.uuid();
const version = z.int().min(1);
const units = z.int().min(1).max(10_000_000);
const optionalText = (max: number) => z.string().trim().max(max).nullable();
const indentLines = z
  .array(z.strictObject({ productId: ref, qty: units }))
  .min(1)
  .max(300);

export class PharmacyRaiseIndentDto extends createZodDto(
  z.strictObject({
    requestingOutletId: ref,
    supplyingOutletId: ref,
    indentDate: day,
    urgent: z.boolean().default(false),
    note: optionalText(1000).default(null),
    lines: indentLines,
  }),
) {}
export class PharmacyEditIndentDto extends createZodDto(
  z.strictObject({
    version,
    urgent: z.boolean().optional(),
    note: optionalText(1000).optional(),
    lines: indentLines.optional(),
  }),
) {}
export class PharmacyEndIndentDto extends createZodDto(
  z.strictObject({ version, reason: z.string().trim().min(1).max(500) }),
) {}
export class PharmacyIndentListQueryDto extends createZodDto(
  z.object({
    ...paginationShape,
    requestingOutletId: ref.optional(),
    supplyingOutletId: ref.optional(),
    status: z.string().trim().max(30).optional(),
  }),
) {}

export class PharmacySendTransferDto extends createZodDto(
  z.strictObject({
    fromOutletId: ref,
    toOutletId: ref,
    indentId: ref.nullable().default(null),
    transferDate: day,
    note: optionalText(1000).default(null),
    lines: z
      .array(z.strictObject({ productId: ref, qty: units, lotId: ref.nullable().default(null) }))
      .min(1)
      .max(300),
  }),
) {}
export class PharmacyDecideTransferDto extends createZodDto(
  z.strictObject({
    version,
    decision: z.enum(['accept', 'reject']),
    on: day,
    reason: optionalText(500).default(null),
  }),
) {}
export class PharmacyTransferListQueryDto extends createZodDto(
  z.object({
    ...paginationShape,
    fromOutletId: ref.optional(),
    toOutletId: ref.optional(),
    status: z.string().trim().max(30).optional(),
  }),
) {}

const productRefShape = {
  productId: z.uuid(),
  displayName: z.string(),
  genericName: z.string(),
  unitName: z.string().nullable(),
};
const indentShape = {
  id: z.uuid(),
  number: z.string(),
  indentDate: z.string(),
  requestingOutletId: z.uuid(),
  requestingOutletName: z.string(),
  supplyingOutletId: z.uuid(),
  supplyingOutletName: z.string(),
  urgent: z.boolean(),
  status: z.string(),
  version: z.int(),
};
export class PharmacyIndentPageResponseDto extends responseDto({
  items: z.array(z.object(indentShape)),
  ...pageMetaShape,
}) {}
export class PharmacyIndentResponseDto extends responseDto({
  ...indentShape,
  note: z.string().nullable(),
  closeReason: z.string().nullable(),
  lines: z.array(z.object({ ...productRefShape, qty: z.int(), transferredQty: z.int(), available: z.int() })),
}) {}

const transferShape = {
  id: z.uuid(),
  number: z.string(),
  transferDate: z.string(),
  indentId: z.uuid().nullable(),
  indentNumber: z.string().nullable(),
  fromOutletId: z.uuid(),
  fromOutletName: z.string(),
  toOutletId: z.uuid(),
  toOutletName: z.string(),
  status: z.string(),
  value: z.number(),
  version: z.int(),
};
export class PharmacyTransferPageResponseDto extends responseDto({
  items: z.array(z.object(transferShape)),
  ...pageMetaShape,
}) {}
export class PharmacyTransferResponseDto extends responseDto({
  ...transferShape,
  note: z.string().nullable(),
  decidedOn: z.string().nullable(),
  rejectReason: z.string().nullable(),
  lines: z.array(
    z.object({
      ...productRefShape,
      lotId: z.uuid(),
      batchNo: z.string().nullable(),
      expiryDate: z.string(),
      qty: z.int(),
      unitCost: z.number(),
      value: z.number(),
    }),
  ),
}) {}
