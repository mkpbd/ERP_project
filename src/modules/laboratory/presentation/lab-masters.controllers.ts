import { z } from 'zod';
import { createRecordController } from '../../../shared/presentation/record-controller.js';
import { recordResponseShape, responseDto, updateSchema } from '../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../shared/presentation/zod/zod-dto.js';
import { LAB_RECORDS as R } from '../application/lab.messages.js';

const name = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable();
const flag = z.enum(['true', 'false']).optional();
const search = z.string().trim().min(1).max(100).optional();
const lab = { tag: 'laboratory', readPermission: 'lab:read', managePermission: 'lab:manage' } as const;

const antibioticFields = { name: name(100), groupName: optionalText(100), isActive: z.boolean() };
const antibiotic = {
  create: z.strictObject({
    name: antibioticFields.name,
    groupName: antibioticFields.groupName.default(null),
    isActive: z.boolean().default(true),
  }),
  update: updateSchema(antibioticFields),
  response: recordResponseShape(antibioticFields),
};
class CreateAntibioticDto extends createZodDto(antibiotic.create) {}
class UpdateAntibioticDto extends createZodDto(antibiotic.update) {}
class AntibioticFilterDto extends createZodDto(z.object({ q: search, isActive: flag })) {}
class AntibioticResponseDto extends responseDto(antibiotic.response) {}

/** Old Diag.CSAntibiotics: the antibiotics of the antibiogram, ordered by their class. */
export const AntibioticsController = createRecordController({
  ...lab,
  className: 'AntibioticsController',
  path: 'lab/antibiotics',
  type: R.antibiotic,
  label: 'antibiotic',
  create: CreateAntibioticDto,
  update: UpdateAntibioticDto,
  response: AntibioticResponseDto,
  filter: AntibioticFilterDto,
});

const organismFields = { name: name(150), isActive: z.boolean() };
const organism = {
  create: z.strictObject({ name: organismFields.name, isActive: z.boolean().default(true) }),
  update: updateSchema(organismFields),
  response: recordResponseShape(organismFields),
};
class CreateOrganismDto extends createZodDto(organism.create) {}
class UpdateOrganismDto extends createZodDto(organism.update) {}
class OrganismFilterDto extends createZodDto(z.object({ q: search, isActive: flag })) {}
class OrganismResponseDto extends responseDto(organism.response) {}

/** Old Diag.MicroBioBacterias: the organisms a culture isolates. */
export const OrganismsController = createRecordController({
  ...lab,
  className: 'OrganismsController',
  path: 'lab/organisms',
  type: R.organism,
  label: 'organism',
  create: CreateOrganismDto,
  update: UpdateOrganismDto,
  response: OrganismResponseDto,
  filter: OrganismFilterDto,
});

const growthTypeFields = { name: name(100) };
class CreateGrowthTypeDto extends createZodDto(z.strictObject(growthTypeFields)) {}
class UpdateGrowthTypeDto extends createZodDto(updateSchema(growthTypeFields)) {}
class GrowthTypeFilterDto extends createZodDto(z.object({ q: search })) {}
class GrowthTypeResponseDto extends responseDto(recordResponseShape(growthTypeFields)) {}

/** Old Diag.CSGrowthTypes: how a culture grew. */
export const GrowthTypesController = createRecordController({
  ...lab,
  className: 'GrowthTypesController',
  path: 'lab/growth-types',
  type: R.growthType,
  label: 'growth type',
  create: CreateGrowthTypeDto,
  update: UpdateGrowthTypeDto,
  response: GrowthTypeResponseDto,
  filter: GrowthTypeFilterDto,
});

const messageFields = { text: name(500) };
class CreateCultureMessageDto extends createZodDto(z.strictObject(messageFields)) {}
class UpdateCultureMessageDto extends createZodDto(updateSchema(messageFields)) {}
class CultureMessageFilterDto extends createZodDto(z.object({ q: search })) {}
class CultureMessageResponseDto extends responseDto(recordResponseShape(messageFields)) {}

/** Old Diag.CSMessases: the usual closing remarks of a culture report. */
export const CultureMessagesController = createRecordController({
  ...lab,
  className: 'CultureMessagesController',
  path: 'lab/culture-messages',
  type: R.cultureMessage,
  label: 'culture message',
  create: CreateCultureMessageDto,
  update: UpdateCultureMessageDto,
  response: CultureMessageResponseDto,
  filter: CultureMessageFilterDto,
});

const templateFields = { name: name(150), description: optionalText(300), body: name(20_000) };
const reportTemplate = {
  create: z.strictObject({
    name: templateFields.name,
    description: templateFields.description.default(null),
    body: templateFields.body,
  }),
  update: updateSchema(templateFields),
  response: recordResponseShape(templateFields),
};
class CreateReportTemplateDto extends createZodDto(reportTemplate.create) {}
class UpdateReportTemplateDto extends createZodDto(reportTemplate.update) {}
class ReportTemplateFilterDto extends createZodDto(z.object({ q: search })) {}
class ReportTemplateResponseDto extends responseDto(reportTemplate.response) {}

/** Old Diag.PathologyTemplates: the usual wording of a written report, to start from. */
export const ReportTemplatesController = createRecordController({
  ...lab,
  className: 'LabReportTemplatesController',
  path: 'lab/report-templates',
  type: R.reportTemplate,
  label: 'report template',
  create: CreateReportTemplateDto,
  update: UpdateReportTemplateDto,
  response: ReportTemplateResponseDto,
  filter: ReportTemplateFilterDto,
});

export const LAB_MASTER_CONTROLLERS = [
  AntibioticsController,
  OrganismsController,
  GrowthTypesController,
  CultureMessagesController,
  ReportTemplatesController,
];
