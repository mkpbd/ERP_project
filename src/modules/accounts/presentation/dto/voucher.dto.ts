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

const day = z.iso.date();
const text = (max: number) => z.string().trim().max(max).nullable();
const STATUSES = ['draft', 'posted', 'reversed'] as const;

const line = z.strictObject({
  glAccountId: z.uuid(),
  debit: z.number().min(0).max(1_000_000_000).default(0),
  credit: z.number().min(0).max(1_000_000_000).default(0),
  narration: text(500).default(null),
  costCenterId: z.uuid().nullable().default(null),
  subLedgerId: z.uuid().nullable().default(null),
  chequeNo: text(30).default(null),
  chequeDate: day.nullable().default(null),
});
const headerFields = {
  journalTypeId: z.uuid(),
  voucherDate: day,
  documentDate: day.nullable(),
  narration: text(1000),
  paidTo: text(200),
  mode: text(30),
  serviceUnitId: z.uuid().nullable(),
};

export class CreateVoucherDto extends createZodDto(
  z.strictObject({
    ...headerFields,
    documentDate: day.nullable().default(null),
    narration: headerFields.narration.default(null),
    paidTo: headerFields.paidTo.default(null),
    mode: headerFields.mode.default(null),
    serviceUnitId: headerFields.serviceUnitId.default(null),
    lines: z.array(line).min(2).max(500),
    post: z.boolean().default(false),
  }),
) {}

export class EditVoucherDto extends createZodDto(
  z
    .strictObject(headerFields)
    .partial()
    .extend({ version: z.int().min(1), lines: z.array(line).min(2).max(500).optional() })
    .refine((value) => Object.keys(value).length > 1, 'Change at least one field'),
) {}

export class VoucherVersionDto extends createZodDto(z.strictObject({ version: z.int().min(1) })) {}
export class VoucherVersionQueryDto extends createZodDto(z.object({ version: z.coerce.number().int().min(1) })) {}
export class ReverseVoucherDto extends createZodDto(
  z.strictObject({ version: z.int().min(1), voucherDate: day, narration: text(1000).default(null) }),
) {}

export class VoucherListQueryDto extends createZodDto(
  z.object({
    ...paginationShape,
    from: day.optional(),
    to: day.optional(),
    journalTypeId: z.uuid().optional(),
    status: z.enum(STATUSES).optional(),
    glAccountId: z.uuid().optional(),
    q: z.string().trim().min(1).max(100).optional(),
    sourceModule: z.string().trim().min(1).max(40).optional(),
    sourceReference: z.string().trim().min(1).max(100).optional(),
  }),
) {}

const summaryShape = {
  id: z.uuid(),
  number: z.string().nullable(),
  journalTypeId: z.uuid(),
  journalShortName: z.string(),
  fiscalYearId: z.uuid().nullable(),
  fiscalYearLabel: z.string().nullable(),
  voucherDate: z.string(),
  documentDate: z.string().nullable(),
  narration: z.string().nullable(),
  paidTo: z.string().nullable(),
  mode: z.string().nullable(),
  serviceUnitId: z.uuid().nullable(),
  status: z.enum(STATUSES),
  sourceModule: z.string().nullable(),
  sourceReference: z.string().nullable(),
  reversalOfId: z.uuid().nullable(),
  reversedById: z.uuid().nullable(),
  total: z.number(),
  createdBy: z.uuid().nullable(),
  postedBy: z.uuid().nullable(),
  postedAt: isoDate.nullable(),
  version: z.int(),
};
export class VoucherPageResponseDto extends responseDto({ items: z.array(z.object(summaryShape)), ...pageMetaShape }) {}
export class VoucherResponseDto extends responseDto({
  ...summaryShape,
  lines: z.array(
    z.object({
      glAccountId: z.uuid(),
      glCode: z.string(),
      glName: z.string(),
      debit: z.number(),
      credit: z.number(),
      narration: z.string().nullable(),
      costCenterId: z.uuid().nullable(),
      subLedgerId: z.uuid().nullable(),
      chequeNo: z.string().nullable(),
      chequeDate: z.string().nullable(),
    }),
  ),
  attachments: z.array(
    z.object({ id: z.uuid(), fileName: z.string(), contentType: z.string(), sizeBytes: z.int(), uploadedAt: isoDate }),
  ),
}) {}
export class CreatedVoucherResponseDto extends responseDto({ id: z.uuid(), number: z.string().nullable() }) {}
export class PostedResponseDto extends responseDto({ number: z.string() }) {}
export class ReversedResponseDto extends responseDto({ id: z.uuid(), number: z.string() }) {}

export class AttachmentParamDto extends createZodDto(z.strictObject({ id: z.uuid(), attachmentId: z.uuid() })) {}
export class AttachmentQueryDto extends createZodDto(z.object({ fileName: z.string().trim().min(1).max(150) })) {}

const roleFields = {
  role: z.string().regex(/^[a-z][a-z0-9_.]{1,59}$/, 'Lower-case letters, digits, dots and underscores'),
  glAccountId: z.uuid(),
  description: text(300),
};
export class CreateGlRoleDto extends createZodDto(
  z.strictObject({ ...roleFields, description: roleFields.description.default(null) }),
) {}
export class UpdateGlRoleDto extends createZodDto(updateSchema(roleFields)) {}
export class GlRoleResponseDto extends responseDto(recordResponseShape(roleFields)) {}

const scheduleFields = {
  section: z.string().trim().min(1).max(60),
  timing: z.enum(['on_sale', 'end_of_day', 'weekly', 'monthly']),
};
export class CreatePostingScheduleDto extends createZodDto(z.strictObject(scheduleFields)) {}
export class UpdatePostingScheduleDto extends createZodDto(updateSchema(scheduleFields)) {}
export class PostingScheduleResponseDto extends responseDto(recordResponseShape(scheduleFields)) {}
