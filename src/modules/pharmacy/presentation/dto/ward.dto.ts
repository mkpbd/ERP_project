import { z } from 'zod';
import { pageMetaShape, paginationShape, responseDto } from '../../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../../shared/presentation/zod/zod-dto.js';

const day = z.iso.date();
const ref = z.uuid();
const version = z.int().min(1);
const units = z.int().min(1).max(10_000_000);
const INDENT_STATUSES = ['open', 'issued', 'cancelled'] as const;
const admissionRef = {
  admissionNumber: z.string().nullable(),
  patientName: z.string().nullable(),
  uhid: z.int().nullable(),
};

export class PharmacyWardIndentDto extends createZodDto(
  z.strictObject({
    outletId: ref,
    admissionId: ref,
    requestedOn: day,
    note: z.string().trim().max(300).nullable().default(null),
    lines: z
      .array(z.strictObject({ productId: ref, qty: units }))
      .min(1)
      .max(300),
  }),
) {}
export class PharmacyWardIndentCancelDto extends createZodDto(
  z.strictObject({ version, reason: z.string().trim().min(1).max(300) }),
) {}
export class PharmacyWardIssueDto extends createZodDto(
  z.strictObject({
    outletId: ref,
    admissionId: ref,
    /** The ward indent it answers, if any. */
    indentId: ref.nullable().default(null),
    issuedOn: day,
    lines: z
      .array(z.strictObject({ productId: ref, qty: units, lotId: ref.nullable().default(null) }))
      .min(1)
      .max(300),
  }),
) {}
export class PharmacyWardReturnDto extends createZodDto(
  z.strictObject({
    version,
    returnedOn: day,
    reason: z.string().trim().max(300).nullable().default(null),
    lines: z
      .array(z.strictObject({ line: z.int().min(1), qty: units }))
      .min(1)
      .max(300),
  }),
) {}
export class PharmacyWardIndentListQueryDto extends createZodDto(
  z.object({
    ...paginationShape,
    outletId: ref.optional(),
    admissionId: ref.optional(),
    status: z.enum(INDENT_STATUSES).optional(),
  }),
) {}
export class PharmacyWardIssueListQueryDto extends createZodDto(
  z.object({
    ...paginationShape,
    outletId: ref.optional(),
    admissionId: ref.optional(),
    from: day.optional(),
    to: day.optional(),
  }),
) {}

const indentSummary = {
  id: ref,
  number: z.string(),
  outletId: ref,
  outletName: z.string(),
  admissionId: ref,
  ...admissionRef,
  requestedOn: z.string(),
  status: z.enum(INDENT_STATUSES),
  lineCount: z.int(),
  version: z.int(),
};
export class PharmacyWardIndentPageResponseDto extends responseDto({
  items: z.array(z.object(indentSummary)),
  ...pageMetaShape,
}) {}
export class PharmacyWardIndentResponseDto extends responseDto({
  ...indentSummary,
  note: z.string().nullable(),
  cancelReason: z.string().nullable(),
  issueId: ref.nullable(),
  lines: z.array(z.object({ productId: ref, productName: z.string(), qty: z.int() })),
}) {}

const issueSummary = {
  id: ref,
  number: z.string(),
  outletId: ref,
  outletName: z.string(),
  admissionId: ref,
  ...admissionRef,
  indentId: ref.nullable(),
  issuedOn: z.string(),
  amount: z.number(),
  discount: z.number(),
  total: z.number(),
  returned: z.number(),
  charged: z.number(),
  version: z.int(),
};
export class PharmacyWardIssuePageResponseDto extends responseDto({
  items: z.array(z.object(issueSummary)),
  ...pageMetaShape,
}) {}
export class PharmacyWardIssueResponseDto extends responseDto({
  ...issueSummary,
  voucherNumber: z.string().nullable(),
  lines: z.array(
    z.object({
      line: z.int(),
      productId: ref,
      productName: z.string(),
      lotId: ref,
      batchNo: z.string().nullable(),
      expiryDate: z.string(),
      qty: z.int(),
      saleRate: z.number(),
      discountPercent: z.number(),
      total: z.number(),
      returnedQty: z.int(),
    }),
  ),
  returns: z.array(
    z.object({ id: ref, number: z.string(), returnedOn: z.string(), reason: z.string().nullable(), total: z.number() }),
  ),
}) {}
export class PharmacyWardIssuedResponseDto extends responseDto({ id: ref, number: z.string(), total: z.number() }) {}
export class PharmacyWardReturnedResponseDto extends responseDto({
  id: ref,
  number: z.string(),
  total: z.number(),
  charged: z.number(),
}) {}
