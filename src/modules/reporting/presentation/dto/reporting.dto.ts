import { z } from 'zod';
import { responseDto } from '../../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../../shared/presentation/zod/zod-dto.js';

const reportKey = z
  .string()
  .regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/, 'Expected a report key such as pharmacy.stock');

export class ReportKeyParamDto extends createZodDto(z.strictObject({ key: reportKey })) {}

export class RenderReportDto extends createZodDto(
  z.strictObject({
    format: z.enum(['pdf', 'xlsx']).default('pdf'),
    /** Checked against the report's own parameter schema. */
    params: z.record(z.string(), z.unknown()).default({}),
  }),
) {}

export class SetRoleReportsDto extends createZodDto(z.strictObject({ reportKeys: z.array(reportKey).max(2000) })) {}

const summaryShape = {
  key: z.string(),
  title: z.string(),
  group: z.string(),
  description: z.string(),
  formats: z.array(z.enum(['pdf', 'xlsx'])),
};

export class ReportSummaryResponseDto extends responseDto(summaryShape) {}

export class ReportDetailResponseDto extends responseDto({
  ...summaryShape,
  parameters: z.record(z.string(), z.unknown()).describe('JSON Schema of the report parameters'),
}) {}

export class RoleReportsResponseDto extends responseDto({ roleId: z.uuid(), reportKeys: z.array(z.string()) }) {}
