import { z } from 'zod';
import { pageMetaShape, paginationShape, responseDto } from '../../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../../shared/presentation/zod/zod-dto.js';

const day = z.iso.date();
const ref = z.uuid();
const amount = z.number().min(0).max(1_000_000_000);

export class AssetListQueryDto extends createZodDto(
  z.object({
    ...paginationShape,
    status: z.enum(['in_stock', 'out_for_service', 'discarded', 'sold', 'returned']).optional(),
    variantId: ref.optional(),
    mainStoreId: ref.optional(),
    subStoreId: ref.optional(),
    departmentId: ref.optional(),
    q: z.string().trim().min(1).max(50).optional(),
  }),
) {}

export class DescribeAssetDto extends createZodDto(
  z.strictObject({
    serialNo: z.string().trim().max(100).nullable().optional(),
    note: z.string().trim().max(1000).nullable().optional(),
  }),
) {}

export class ConfigureDepreciationDto extends createZodDto(
  z
    .strictObject({
      assetIds: z.array(ref).min(1).max(1000),
      frequency: z.enum(['monthly', 'quarterly', 'half_yearly', 'yearly']).default('monthly'),
      lifeMonths: z.int().min(1).max(1200),
      residualAmount: amount.optional(),
      residualPercent: z.number().min(0).max(100).optional(),
      startDate: day.nullable().default(null),
      cost: amount.nullable().default(null),
      opening: z.strictObject({ accumulated: amount, asOf: day }).nullable().default(null),
    })
    .refine((value) => value.residualAmount === undefined || value.residualPercent === undefined, {
      message: 'Give the residual as an amount or a percentage, not both',
      path: ['residualPercent'],
    }),
) {}

export class AsOfQueryDto extends createZodDto(z.object({ asOf: day })) {}
export class PostRunDto extends createZodDto(z.strictObject({ asOf: day })) {}
export class ReverseRunDto extends createZodDto(
  z.strictObject({ reason: z.string().trim().min(1).max(500), on: day }),
) {}
export class RunListQueryDto extends createZodDto(z.object({ ...paginationShape })) {}

const assetSummaryShape = {
  id: z.uuid(),
  assetNo: z.string(),
  variantId: z.uuid(),
  itemName: z.string(),
  variantName: z.string(),
  status: z.string(),
  placeName: z.string().nullable(),
  mainStoreId: z.uuid().nullable(),
  subStoreId: z.uuid().nullable(),
  departmentId: z.uuid().nullable(),
  cost: z.number(),
  acquiredOn: z.string(),
  sourceNumber: z.string(),
  serialNo: z.string().nullable(),
  accumulated: z.number().nullable(),
  bookValue: z.number(),
  depreciationStatus: z.string().nullable(),
};
const profileShape = z.object({
  assetId: z.uuid(),
  frequency: z.string(),
  lifeMonths: z.int(),
  cost: z.number(),
  residual: z.number(),
  startDate: z.string(),
  openingAccumulated: z.number(),
  periodsDone: z.int(),
  accumulated: z.number(),
  lastPeriodEnd: z.string().nullable(),
  status: z.string(),
});

export class AssetPageResponseDto extends responseDto({
  items: z.array(z.object(assetSummaryShape)),
  ...pageMetaShape,
}) {}
export class AssetResponseDto extends responseDto({
  ...assetSummaryShape,
  batchNo: z.string().nullable(),
  expiryDate: z.string().nullable(),
  supplierName: z.string().nullable(),
  note: z.string().nullable(),
  depreciation: profileShape.nullable(),
  charges: z.array(z.object({ runNumber: z.string(), periodEnd: z.string(), amount: z.number() })),
}) {}
export class ConfiguredResponseDto extends responseDto({ configured: z.int() }) {}
export class RunPreviewResponseDto extends responseDto({
  asOf: z.string(),
  assetCount: z.int(),
  total: z.number(),
  lines: z.array(z.object({ assetId: z.uuid(), assetNo: z.string(), periods: z.int(), amount: z.number() })),
}) {}
export class PostedRunResponseDto extends responseDto({
  id: z.uuid(),
  number: z.string(),
  total: z.number(),
  voucherNumber: z.string().nullable(),
}) {}
export class ReversedRunResponseDto extends responseDto({ voucherNumber: z.string().nullable() }) {}
const runSummaryShape = {
  id: z.uuid(),
  number: z.string(),
  asOf: z.string(),
  status: z.string(),
  assetCount: z.int(),
  total: z.number(),
  voucherNumber: z.string().nullable(),
  reversalVoucherNumber: z.string().nullable(),
};
export class RunPageResponseDto extends responseDto({ items: z.array(z.object(runSummaryShape)), ...pageMetaShape }) {}
export class RunResponseDto extends responseDto({
  ...runSummaryShape,
  entries: z.array(
    z.object({
      assetId: z.uuid(),
      assetNo: z.string(),
      periodIndex: z.int(),
      periodEnd: z.string(),
      amount: z.number(),
      departmentId: z.uuid().nullable(),
    }),
  ),
}) {}
