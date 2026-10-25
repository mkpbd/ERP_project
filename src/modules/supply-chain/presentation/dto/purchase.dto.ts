import { z } from 'zod';
import { pageMetaShape, paginationShape, responseDto } from '../../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../../shared/presentation/zod/zod-dto.js';

const day = z.iso.date();
const ref = z.uuid();
const text = (max: number) => z.string().trim().max(max).nullable();
const quantity = z.number().positive().max(1_000_000_000);
const amount = z.number().min(0).max(1_000_000_000);
const percent = z.number().min(0).max(100);
const version = z.int().min(1);
const decisionShape = {
  levelOrder: z.int(),
  levelName: z.string(),
  decision: z.enum(['approved', 'rejected']),
  decidedBy: z.uuid().nullable(),
  decidedAt: z.date(),
  remarks: z.string().nullable(),
};
const itemShape = {
  variantId: z.uuid(),
  variantName: z.string(),
  code: z.string().nullable(),
  itemName: z.string(),
  unit: z.string(),
};

export class DocumentListQueryDto extends createZodDto(
  z.object({
    ...paginationShape,
    status: z.string().trim().max(30).optional(),
    from: day.optional(),
    to: day.optional(),
    q: z.string().trim().min(1).max(50).optional(),
    mainStoreId: ref.optional(),
    supplierId: ref.optional(),
    requisitionId: ref.optional(),
  }),
) {}

export class VersionDto extends createZodDto(z.strictObject({ version })) {}
export class VersionQueryDto extends createZodDto(z.object({ version: z.coerce.number().int().min(1) })) {}
export class CreatedDocumentResponseDto extends responseDto({ id: z.uuid(), number: z.string() }) {}
export class DecisionResultResponseDto extends responseDto({ status: z.string() }) {}

// Requisitions

const requisitionLine = z.strictObject({
  variantId: ref,
  requestedQty: quantity,
  description: text(300).default(null),
});
const requisitionHeader = {
  mainStoreId: ref,
  subStoreId: ref.nullable(),
  departmentId: ref.nullable(),
  supplierId: ref.nullable(),
  requisitionDate: day,
  paymentTerm: z.enum(['cash', 'credit']).nullable(),
  note: text(1000),
  terms: text(2000),
};

export class CreateRequisitionDto extends createZodDto(
  z.strictObject({
    ...requisitionHeader,
    subStoreId: requisitionHeader.subStoreId.default(null),
    departmentId: requisitionHeader.departmentId.default(null),
    supplierId: requisitionHeader.supplierId.default(null),
    paymentTerm: requisitionHeader.paymentTerm.default(null),
    note: requisitionHeader.note.default(null),
    terms: requisitionHeader.terms.default(null),
    lines: z.array(requisitionLine).min(1).max(300),
  }),
) {}

export class EditRequisitionDto extends createZodDto(
  z.strictObject({
    version,
    mainStoreId: requisitionHeader.mainStoreId.optional(),
    subStoreId: requisitionHeader.subStoreId.optional(),
    departmentId: requisitionHeader.departmentId.optional(),
    supplierId: requisitionHeader.supplierId.optional(),
    requisitionDate: requisitionHeader.requisitionDate.optional(),
    paymentTerm: requisitionHeader.paymentTerm.optional(),
    note: requisitionHeader.note.optional(),
    terms: requisitionHeader.terms.optional(),
    lines: z.array(requisitionLine).min(1).max(300).optional(),
  }),
) {}

export class DecideRequisitionDto extends createZodDto(
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

const requisitionSummaryShape = {
  id: z.uuid(),
  number: z.string(),
  requisitionDate: z.string(),
  mainStoreId: z.uuid(),
  mainStoreName: z.string(),
  departmentName: z.string().nullable(),
  supplierName: z.string().nullable(),
  paymentTerm: z.string().nullable(),
  status: z.string(),
  currentLevel: z.int().nullable(),
  currentLevelName: z.string().nullable(),
  lineCount: z.int(),
  version: z.int(),
};
export class RequisitionPageResponseDto extends responseDto({
  items: z.array(z.object(requisitionSummaryShape)),
  ...pageMetaShape,
}) {}
export class RequisitionInboxResponseDto extends responseDto({ items: z.array(z.object(requisitionSummaryShape)) }) {}
export class RequisitionResponseDto extends responseDto({
  ...requisitionSummaryShape,
  subStoreId: z.uuid().nullable(),
  subStoreName: z.string().nullable(),
  departmentId: z.uuid().nullable(),
  supplierId: z.uuid().nullable(),
  note: z.string().nullable(),
  terms: z.string().nullable(),
  createdBy: z.uuid().nullable(),
  createdAt: z.date(),
  lines: z.array(
    z.object({
      ...itemShape,
      requestedQty: z.number(),
      approvedQty: z.number().nullable(),
      orderedQty: z.number(),
      description: z.string().nullable(),
    }),
  ),
  decisions: z.array(z.object(decisionShape)),
}) {}

// Comparative studies

const quote = z.strictObject({
  supplierId: ref,
  variantId: ref.nullable().default(null),
  manualName: text(200).default(null),
  qty: quantity,
  unitPrice: amount,
  vatPercent: percent.default(0),
  aitPercent: percent.default(0),
});
const studyHeader = {
  studyDate: day,
  requisitionId: ref.nullable(),
  title: z.string().trim().min(1).max(200),
  note: text(1000),
};

export class CreateStudyDto extends createZodDto(
  z.strictObject({
    ...studyHeader,
    requisitionId: studyHeader.requisitionId.default(null),
    note: studyHeader.note.default(null),
    quotes: z.array(quote).min(1).max(300),
  }),
) {}

export class EditStudyDto extends createZodDto(
  z.strictObject({
    version,
    studyDate: day.optional(),
    requisitionId: ref.nullable().optional(),
    title: studyHeader.title.optional(),
    note: studyHeader.note.optional(),
    quotes: z.array(quote).min(1).max(300).optional(),
  }),
) {}

export class DecideStudyDto extends createZodDto(
  z.strictObject({
    version,
    decision: z.enum(['approve', 'reject']),
    remarks: text(500).default(null),
    keep: z.array(ref).max(300).default([]),
  }),
) {}

const studySummaryShape = {
  id: z.uuid(),
  number: z.string(),
  studyDate: z.string(),
  title: z.string(),
  requisitionId: z.uuid().nullable(),
  requisitionNumber: z.string().nullable(),
  status: z.string(),
  currentLevel: z.int().nullable(),
  currentLevelName: z.string().nullable(),
  quoteCount: z.int(),
  version: z.int(),
};
export class StudyPageResponseDto extends responseDto({
  items: z.array(z.object(studySummaryShape)),
  ...pageMetaShape,
}) {}
export class StudyInboxResponseDto extends responseDto({ items: z.array(z.object(studySummaryShape)) }) {}
export class StudyResponseDto extends responseDto({
  ...studySummaryShape,
  note: z.string().nullable(),
  createdBy: z.uuid().nullable(),
  createdAt: z.date(),
  quotes: z.array(
    z.object({
      id: z.uuid(),
      supplierId: z.uuid(),
      supplierName: z.string(),
      variantId: z.uuid().nullable(),
      itemName: z.string(),
      unit: z.string().nullable(),
      manualName: z.string().nullable(),
      qty: z.number(),
      unitPrice: z.number(),
      vatPercent: z.number(),
      aitPercent: z.number(),
      vat: z.number(),
      ait: z.number(),
      total: z.number(),
      selected: z.boolean(),
    }),
  ),
  decisions: z.array(z.object(decisionShape)),
}) {}

// Purchase orders

const orderLine = z.strictObject({ variantId: ref, qty: quantity, rate: amount, vatPercent: percent.default(0) });

export class CreateOrderDto extends createZodDto(
  z
    .strictObject({
      supplierId: ref,
      mainStoreId: ref,
      requisitionId: ref.nullable().default(null),
      comparativeStudyId: ref.nullable().default(null),
      orderDate: day,
      expectedOn: day.nullable().default(null),
      terms: text(2000).default(null),
      note: text(1000).default(null),
      lines: z.array(orderLine).min(1).max(300),
    })
    .refine((value) => !value.expectedOn || value.expectedOn >= value.orderDate, {
      message: 'The expected date is before the order date',
      path: ['expectedOn'],
    }),
) {}

export class EditOrderDto extends createZodDto(
  z.strictObject({
    version,
    orderDate: day.optional(),
    expectedOn: day.nullable().optional(),
    terms: text(2000).optional(),
    note: text(1000).optional(),
    lines: z.array(orderLine).min(1).max(300).optional(),
  }),
) {}

export class CancelOrderDto extends createZodDto(
  z.strictObject({ version, reason: z.string().trim().min(1).max(500) }),
) {}

const orderSummaryShape = {
  id: z.uuid(),
  number: z.string(),
  orderDate: z.string(),
  expectedOn: z.string().nullable(),
  supplierId: z.uuid(),
  supplierName: z.string(),
  mainStoreId: z.uuid(),
  mainStoreName: z.string(),
  requisitionId: z.uuid().nullable(),
  requisitionNumber: z.string().nullable(),
  comparativeStudyId: z.uuid().nullable(),
  comparativeStudyNumber: z.string().nullable(),
  status: z.string(),
  amount: z.number(),
  vat: z.number(),
  total: z.number(),
  version: z.int(),
};
export class OrderPageResponseDto extends responseDto({
  items: z.array(z.object(orderSummaryShape)),
  ...pageMetaShape,
}) {}
export class OrderResponseDto extends responseDto({
  ...orderSummaryShape,
  supplierAddress: z.string().nullable(),
  supplierContactNo: z.string().nullable(),
  terms: z.string().nullable(),
  note: z.string().nullable(),
  cancelReason: z.string().nullable(),
  createdBy: z.uuid().nullable(),
  createdAt: z.date(),
  lines: z.array(
    z.object({
      ...itemShape,
      qty: z.number(),
      rate: z.number(),
      vatPercent: z.number(),
      amount: z.number(),
      vat: z.number(),
      total: z.number(),
      receivedQty: z.number(),
    }),
  ),
}) {}
