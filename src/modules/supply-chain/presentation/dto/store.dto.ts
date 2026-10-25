import { z } from 'zod';
import { pageMetaShape, paginationShape, responseDto } from '../../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../../shared/presentation/zod/zod-dto.js';

const day = z.iso.date();
const ref = z.uuid();
const text = (max: number) => z.string().trim().max(max).nullable();
const quantity = z.number().positive().max(1_000_000_000);
const version = z.int().min(1);
const priority = z.enum(['routine', 'emergency', 'critical_care', 'new_admission', 'discharge', 'other']);
const itemShape = {
  variantId: z.uuid(),
  variantName: z.string(),
  code: z.string().nullable(),
  itemName: z.string(),
  unit: z.string(),
};
const decisionShape = {
  levelOrder: z.int(),
  levelName: z.string(),
  decision: z.enum(['approved', 'rejected']),
  decidedBy: z.uuid().nullable(),
  decidedAt: z.date(),
  remarks: z.string().nullable(),
};
const partShape = {
  ...itemShape,
  batchNo: z.string().nullable(),
  expiryDate: z.string().nullable(),
  qty: z.number(),
  unitCost: z.number(),
};

export class StoreListQueryDto extends createZodDto(
  z.object({
    ...paginationShape,
    status: z.string().trim().max(30).optional(),
    from: day.optional(),
    to: day.optional(),
    q: z.string().trim().min(1).max(50).optional(),
    mainStoreId: ref.optional(),
    subStoreId: ref.optional(),
    departmentId: ref.optional(),
    requestId: ref.optional(),
    kind: z.enum(['main_to_sub', 'sub_to_main', 'sub_to_sub']).optional(),
  }),
) {}

// Indents

const indentLine = z.strictObject({ variantId: ref, qty: quantity, remarks: text(300).default(null) });

export class CreateIndentDto extends createZodDto(
  z.strictObject({
    subStoreId: ref,
    departmentId: ref.nullable().default(null),
    indentDate: day,
    priority: priority.default('routine'),
    note: text(1000).default(null),
    lines: z.array(indentLine).min(1).max(300),
  }),
) {}

export class EditIndentDto extends createZodDto(
  z.strictObject({
    version,
    subStoreId: ref.optional(),
    departmentId: ref.nullable().optional(),
    indentDate: day.optional(),
    priority: priority.optional(),
    note: text(1000).optional(),
    lines: z.array(indentLine).min(1).max(300).optional(),
  }),
) {}

export class DecideIndentDto extends createZodDto(
  z.strictObject({
    version,
    decision: z.enum(['approve', 'reject']),
    remarks: text(500).default(null),
    quantities: z
      .array(z.strictObject({ variantId: ref, approvedQty: z.number().min(0).max(1_000_000_000) }))
      .max(300)
      .default([]),
  }),
) {}

export class ShortfallQueryDto extends createZodDto(z.object({ on: day })) {}

const indentSummaryShape = {
  id: z.uuid(),
  number: z.string(),
  indentDate: z.string(),
  subStoreId: z.uuid(),
  subStoreName: z.string(),
  departmentId: z.uuid().nullable(),
  departmentName: z.string().nullable(),
  priority: z.string(),
  status: z.string(),
  currentLevel: z.int().nullable(),
  currentLevelName: z.string().nullable(),
  lineCount: z.int(),
  version: z.int(),
};
export class IndentPageResponseDto extends responseDto({
  items: z.array(z.object(indentSummaryShape)),
  ...pageMetaShape,
}) {}
export class IndentInboxResponseDto extends responseDto({ items: z.array(z.object(indentSummaryShape)) }) {}
export class IndentResponseDto extends responseDto({
  ...indentSummaryShape,
  note: z.string().nullable(),
  createdBy: z.uuid().nullable(),
  createdAt: z.date(),
  acknowledgedBy: z.uuid().nullable(),
  acknowledgedAt: z.date().nullable(),
  lines: z.array(
    z.object({
      ...itemShape,
      qty: z.number(),
      approvedQty: z.number().nullable(),
      servedQty: z.number(),
      remarks: z.string().nullable(),
    }),
  ),
  decisions: z.array(z.object(decisionShape)),
}) {}
export class ShortfallResponseDto extends responseDto({
  items: z.array(z.object({ ...itemShape, open: z.number(), inStock: z.number(), shortfall: z.number() })),
}) {}

// Store requests

export class CreateRequestDto extends createZodDto(
  z.strictObject({
    subStoreId: ref,
    requestDate: day,
    note: text(1000).default(null),
    lines: z
      .array(z.strictObject({ variantId: ref, qty: quantity }))
      .min(1)
      .max(300),
  }),
) {}

export class RaisePurchaseDto extends createZodDto(z.strictObject({ version, requisitionDate: day })) {}

const requestSummaryShape = {
  id: z.uuid(),
  number: z.string(),
  requestDate: z.string(),
  subStoreId: z.uuid(),
  subStoreName: z.string(),
  mainStoreId: z.uuid(),
  mainStoreName: z.string(),
  status: z.string(),
  purchaseRequisitionId: z.uuid().nullable(),
  purchaseRequisitionNumber: z.string().nullable(),
  version: z.int(),
};
export class RequestPageResponseDto extends responseDto({
  items: z.array(z.object(requestSummaryShape)),
  ...pageMetaShape,
}) {}
export class RequestResponseDto extends responseDto({
  ...requestSummaryShape,
  note: z.string().nullable(),
  createdBy: z.uuid().nullable(),
  createdAt: z.date(),
  lines: z.array(z.object({ ...itemShape, qty: z.number(), servedQty: z.number() })),
}) {}

// Issues and transfers

const moveLine = z.strictObject({ variantId: ref, qty: quantity, lotId: ref.nullable().default(null) });

export class CreateIssueDto extends createZodDto(
  z.strictObject({
    subStoreId: ref,
    departmentId: ref,
    indentId: ref.nullable().default(null),
    issueDate: day,
    receivedByStaffId: ref.nullable().default(null),
    note: text(500).default(null),
    lines: z.array(moveLine).min(1).max(300),
  }),
) {}

const issueSummaryShape = {
  id: z.uuid(),
  number: z.string(),
  issueDate: z.string(),
  subStoreId: z.uuid(),
  subStoreName: z.string(),
  departmentId: z.uuid(),
  departmentName: z.string(),
  indentId: z.uuid().nullable(),
  indentNumber: z.string().nullable(),
};
export class IssuePageResponseDto extends responseDto({
  items: z.array(z.object(issueSummaryShape)),
  ...pageMetaShape,
}) {}
export class IssueResponseDto extends responseDto({
  ...issueSummaryShape,
  receivedByStaffId: z.uuid().nullable(),
  note: z.string().nullable(),
  issuedBy: z.uuid().nullable(),
  createdAt: z.date(),
  parts: z.array(z.object(partShape)),
  value: z.number(),
}) {}

const storeSide = { mainStoreId: ref.optional(), subStoreId: ref.optional() };
const oneSide = (value: { mainStoreId?: string | undefined; subStoreId?: string | undefined }) =>
  (value.mainStoreId === undefined) !== (value.subStoreId === undefined);

export class CreateTransferDto extends createZodDto(
  z.strictObject({
    from: z.strictObject(storeSide).refine(oneSide, 'Give either a main store or a sub-store'),
    to: z.strictObject(storeSide).refine(oneSide, 'Give either a main store or a sub-store'),
    requestId: ref.nullable().default(null),
    transferDate: day,
    note: text(500).default(null),
    lines: z.array(moveLine).min(1).max(300),
  }),
) {}

export class DecideTransferDto extends createZodDto(
  z.strictObject({
    version,
    decision: z.enum(['accept', 'reject']),
    reason: text(500).default(null),
    /** The date the goods arrived (accept only). */
    on: day.nullable().default(null),
    accepted: z
      .array(z.strictObject({ line: z.int().min(1).max(300), qty: z.number().min(0).max(1_000_000_000) }))
      .max(300)
      .default([]),
  }),
) {}

export class CreatedTransferResponseDto extends responseDto({ id: z.uuid(), number: z.string(), status: z.string() }) {}

const transferSummaryShape = {
  id: z.uuid(),
  number: z.string(),
  kind: z.string(),
  transferDate: z.string(),
  fromName: z.string(),
  toName: z.string(),
  fromMainStoreId: z.uuid().nullable(),
  fromSubStoreId: z.uuid().nullable(),
  toMainStoreId: z.uuid().nullable(),
  toSubStoreId: z.uuid().nullable(),
  requestId: z.uuid().nullable(),
  requestNumber: z.string().nullable(),
  status: z.string(),
  version: z.int(),
};
export class TransferPageResponseDto extends responseDto({
  items: z.array(z.object(transferSummaryShape)),
  ...pageMetaShape,
}) {}
export class TransferResponseDto extends responseDto({
  ...transferSummaryShape,
  note: z.string().nullable(),
  rejectReason: z.string().nullable(),
  sentBy: z.uuid().nullable(),
  decidedBy: z.uuid().nullable(),
  decidedAt: z.date().nullable(),
  lines: z.array(
    z.object({ ...itemShape, qty: z.number(), acceptedQty: z.number().nullable(), lotId: z.uuid().nullable() }),
  ),
  parts: z.array(z.object(partShape)),
  value: z.number(),
}) {}
