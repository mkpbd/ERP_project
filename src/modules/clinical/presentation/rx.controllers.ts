import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import type { Actor } from '../../../shared/application/actor.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import {
  IdParamDto,
  pageMetaShape,
  paginationShape,
  responseDto,
} from '../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../shared/presentation/zod/zod-dto.js';
import {
  CancelPrescriptionCommand,
  CreatePhraseCommand,
  CreateTemplateCommand,
  DeletePhraseCommand,
  DeleteTemplateCommand,
  GetPrescriptionQuery,
  GetTemplateQuery,
  ListPhrasesQuery,
  ListPrescriptionsQuery,
  ListTemplatesQuery,
  OpenPrescriptionCommand,
  RecordVitalsCommand,
  ReopenPrescriptionCommand,
  SearchMedicinesQuery,
  SearchTestsQuery,
  SignPrescriptionCommand,
  UpdatePhraseCommand,
  UpdateTemplateCommand,
  WritePrescriptionCommand,
} from '../application/rx.messages.js';
import { PHRASE_KINDS } from '../domain/prescription.js';

const version = z.int().min(1);
const day = z.iso.date();
const note = (max: number) => z.string().max(max).nullable().default(null);
const STATUSES = ['draft', 'signed', 'cancelled'] as const;

const drugInput = z.strictObject({
  productId: z.uuid().nullable().default(null),
  /** Needed when no product is given. */
  name: z.string().max(200).nullable().default(null),
  dose: z.string().max(300),
  duration: note(100),
  qty: z.int().min(1).max(10_000).nullable().default(null),
});
const testInput = z.strictObject({
  testId: z.uuid().nullable().default(null),
  name: z.string().max(200).nullable().default(null),
  note: note(200),
});
const linesShape = {
  drugs: z.array(drugInput).max(40).default([]),
  tests: z.array(testInput).max(60).default([]),
  advices: z.array(z.string().max(500)).max(40).default([]),
};

class OpenDto extends createZodDto(
  z.strictObject({
    appointmentId: z.uuid().nullable().default(null),
    patientId: z.uuid().nullable().default(null),
    doctorId: z.uuid().nullable().default(null),
  }),
) {}
class VitalsDto extends createZodDto(
  z.strictObject({
    version,
    weightKg: z.number().nullable().default(null),
    heightCm: z.number().nullable().default(null),
    bpSystolic: z.int().nullable().default(null),
    bpDiastolic: z.int().nullable().default(null),
    pulse: z.int().nullable().default(null),
    temperatureF: z.number().nullable().default(null),
    spo2: z.int().nullable().default(null),
  }),
) {}
class WriteDto extends createZodDto(
  z.strictObject({
    version,
    complaints: z
      .array(z.strictObject({ complaint: z.string().max(200), duration: note(50) }))
      .max(20)
      .default([]),
    history: note(4000),
    pastHistory: note(2000),
    drugHistory: note(2000),
    examination: note(4000),
    diagnosis: note(1000),
    treatmentPlan: note(2000),
    notes: note(2000),
    followUpOn: day.nullable().default(null),
    followUpNote: note(300),
    referral: note(500),
    ...linesShape,
  }),
) {}
class VersionDto extends createZodDto(z.strictObject({ version })) {}
class CancelDto extends createZodDto(z.strictObject({ version, reason: note(300) })) {}
class RxListQueryDto extends createZodDto(
  z.object({
    ...paginationShape,
    mine: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
    doctorId: z.uuid().optional(),
    patientId: z.uuid().optional(),
    status: z.enum(STATUSES).optional(),
    from: day.optional(),
    to: day.optional(),
    number: z.string().trim().min(1).max(30).optional(),
  }),
) {}
class PhraseDto extends createZodDto(
  z.strictObject({
    kind: z.enum(PHRASE_KINDS),
    text: z.string().max(500),
    shortKey: note(20),
    genericId: z.uuid().nullable().default(null),
    shared: z.boolean().default(false),
  }),
) {}
class PhraseUpdateDto extends createZodDto(z.strictObject({ text: z.string().max(500), shortKey: note(20) })) {}
class PhraseQueryDto extends createZodDto(
  z.object({
    kind: z.enum(PHRASE_KINDS).optional(),
    q: z.string().trim().min(1).max(100).optional(),
    genericId: z.uuid().optional(),
  }),
) {}
const templateShape = { name: z.string().max(100), diagnosis: note(1000), ...linesShape };
class TemplateDto extends createZodDto(z.strictObject(templateShape)) {}
class TemplateUpdateDto extends createZodDto(z.strictObject({ version, ...templateShape })) {}
class SearchQueryDto extends createZodDto(z.object({ q: z.string().trim().min(2).max(100) })) {}

const drugShape = z.object({
  productId: z.uuid().nullable(),
  name: z.string(),
  dose: z.string(),
  duration: z.string().nullable(),
  qty: z.int().nullable(),
});
const testShape = z.object({ testId: z.uuid().nullable(), name: z.string(), note: z.string().nullable() });
const rowShape = {
  id: z.uuid(),
  number: z.string(),
  patientId: z.uuid(),
  doctorId: z.uuid(),
  appointmentId: z.uuid().nullable(),
  visitNo: z.int(),
  visitOn: z.string(),
  status: z.enum(STATUSES),
  diagnosis: z.string().nullable(),
  signedAt: z.date().nullable(),
};
const phraseShape = z.object({
  id: z.uuid(),
  doctorId: z.uuid().nullable(),
  kind: z.enum(PHRASE_KINDS),
  text: z.string(),
  shortKey: z.string().nullable(),
  genericId: z.uuid().nullable(),
});

class OpenedResponseDto extends responseDto({ id: z.uuid(), number: z.string() }) {}
class VersionResponseDto extends responseDto({ version: z.int() }) {}
class IdResponseDto extends responseDto({ id: z.uuid() }) {}
class RxPageResponseDto extends responseDto({
  items: z.array(z.object({ ...rowShape, patientName: z.string(), uhid: z.int().nullable(), doctorName: z.string() })),
  ...pageMetaShape,
}) {}
class RxResponseDto extends responseDto({
  ...rowShape,
  weightKg: z.number().nullable(),
  heightCm: z.number().nullable(),
  bpSystolic: z.int().nullable(),
  bpDiastolic: z.int().nullable(),
  pulse: z.int().nullable(),
  temperatureF: z.number().nullable(),
  spo2: z.int().nullable(),
  bmi: z.number().nullable(),
  vitalsBy: z.uuid().nullable(),
  vitalsAt: z.date().nullable(),
  complaints: z.array(z.object({ complaint: z.string(), duration: z.string().nullable() })),
  history: z.string().nullable(),
  pastHistory: z.string().nullable(),
  drugHistory: z.string().nullable(),
  examination: z.string().nullable(),
  treatmentPlan: z.string().nullable(),
  notes: z.string().nullable(),
  followUpOn: z.string().nullable(),
  followUpNote: z.string().nullable(),
  referral: z.string().nullable(),
  drugs: z.array(drugShape),
  tests: z.array(testShape),
  advices: z.array(z.string()),
  signedBy: z.uuid().nullable(),
  cancelReason: z.string().nullable(),
  openedBy: z.uuid().nullable(),
  version: z.int(),
  updatedAt: z.date(),
  patient: z.object({
    id: z.uuid(),
    uhid: z.int(),
    name: z.string(),
    sex: z.string(),
    dateOfBirth: z.string(),
    bloodGroup: z.string().nullable(),
  }),
  doctor: z.object({
    id: z.uuid(),
    name: z.string(),
    degrees: z.string().nullable(),
    specialityName: z.string().nullable(),
  }),
}) {}
class PhraseListResponseDto extends responseDto({ items: z.array(phraseShape) }) {}
class TemplateListResponseDto extends responseDto({
  items: z.array(z.object({ id: z.uuid(), name: z.string(), diagnosis: z.string().nullable() })),
}) {}
class TemplateResponseDto extends responseDto({
  id: z.uuid(),
  doctorId: z.uuid(),
  name: z.string(),
  diagnosis: z.string().nullable(),
  drugs: z.array(drugShape),
  tests: z.array(testShape),
  advices: z.array(z.string()),
  version: z.int(),
}) {}
class MedicineListResponseDto extends responseDto({
  items: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      genericId: z.uuid(),
      genericName: z.string(),
      isActive: z.boolean(),
    }),
  ),
}) {}
class TestListResponseDto extends responseDto({
  items: z.array(z.object({ id: z.uuid(), name: z.string(), departmentKind: z.string() })),
}) {}

@ApiTags('clinical')
@ApiBearerAuth()
@Controller({ path: 'clinical', version: '1' })
export class RxController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('prescriptions')
  @RequirePermissions('rx:read')
  @ApiOperation({ summary: "By doctor (or `mine`), patient, days, state or number; the patient's history" })
  @ApiOkResponse({ type: RxPageResponseDto })
  list(@CurrentUser() actor: Actor, @Query() query: RxListQueryDto) {
    return this.queryBus.execute(new ListPrescriptionsQuery(actor, query));
  }

  @Get('prescriptions/:id')
  @RequirePermissions('rx:read')
  @ApiOkResponse({ type: RxResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetPrescriptionQuery(actor, params.id));
  }

  @Post('prescriptions')
  @ApiOperation({
    summary: "Open a visit: from today's appointment, or for a patient and doctor (assistant, or the doctor)",
  })
  @ApiCreatedResponse({ type: OpenedResponseDto })
  open(@CurrentUser() actor: Actor, @Body() dto: OpenDto) {
    return this.commandBus.execute(new OpenPrescriptionCommand(actor, dto));
  }

  @Put('prescriptions/:id/vitals')
  @ApiOperation({ summary: 'Weight, height, blood pressure, pulse, temperature (°F), SpO2 of a draft' })
  @ApiOkResponse({ type: VersionResponseDto })
  vitals(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: VitalsDto) {
    const { version: rxVersion, ...vitals } = dto;
    return this.commandBus.execute(new RecordVitalsCommand(actor, params.id, rxVersion, vitals));
  }

  @Put('prescriptions/:id')
  @RequirePermissions('rx:write')
  @ApiOperation({ summary: 'The whole prescription as the doctor writes it (a draft of their own)' })
  @ApiOkResponse({ type: VersionResponseDto })
  write(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: WriteDto) {
    const { version: rxVersion, ...content } = dto;
    return this.commandBus.execute(new WritePrescriptionCommand(actor, params.id, rxVersion, content));
  }

  @Post('prescriptions/:id/sign')
  @RequirePermissions('rx:write')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: VersionResponseDto })
  sign(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: VersionDto) {
    return this.commandBus.execute(new SignPrescriptionCommand(actor, params.id, dto.version));
  }

  @Post('prescriptions/:id/reopen')
  @RequirePermissions('rx:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Back to a draft for a correction, on the visit's day only" })
  @ApiOkResponse({ type: VersionResponseDto })
  reopen(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: VersionDto) {
    return this.commandBus.execute(new ReopenPrescriptionCommand(actor, params.id, dto.version));
  }

  @Post('prescriptions/:id/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'A draft never signed: the patient left' })
  @ApiNoContentResponse()
  async cancel(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: CancelDto) {
    await this.commandBus.execute(new CancelPrescriptionCommand(actor, params.id, dto.version, dto.reason));
  }

  @Get('phrases')
  @RequirePermissions('rx:read')
  @ApiOperation({ summary: "Shared pick lists with the signed-in doctor's own first" })
  @ApiOkResponse({ type: PhraseListResponseDto })
  async phrases(@CurrentUser() actor: Actor, @Query() query: PhraseQueryDto) {
    return { items: await this.queryBus.execute(new ListPhrasesQuery(actor, query)) };
  }

  @Post('phrases')
  @ApiOperation({ summary: "The doctor's own (rx:write), or shared by all (`shared`, rx:manage)" })
  @ApiCreatedResponse({ type: IdResponseDto })
  createPhrase(@CurrentUser() actor: Actor, @Body() dto: PhraseDto) {
    return this.commandBus.execute(new CreatePhraseCommand(actor, dto));
  }

  @Put('phrases/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async updatePhrase(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: PhraseUpdateDto) {
    await this.commandBus.execute(new UpdatePhraseCommand(actor, params.id, dto.text, dto.shortKey));
  }

  @Delete('phrases/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async deletePhrase(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    await this.commandBus.execute(new DeletePhraseCommand(actor, params.id));
  }

  @Get('templates')
  @RequirePermissions('rx:write')
  @ApiOkResponse({ type: TemplateListResponseDto })
  async templates(@CurrentUser() actor: Actor) {
    return { items: await this.queryBus.execute(new ListTemplatesQuery(actor)) };
  }

  @Get('templates/:id')
  @RequirePermissions('rx:write')
  @ApiOkResponse({ type: TemplateResponseDto })
  template(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetTemplateQuery(actor, params.id));
  }

  @Post('templates')
  @RequirePermissions('rx:write')
  @ApiCreatedResponse({ type: IdResponseDto })
  createTemplate(@CurrentUser() actor: Actor, @Body() dto: TemplateDto) {
    return this.commandBus.execute(new CreateTemplateCommand(actor, dto));
  }

  @Put('templates/:id')
  @RequirePermissions('rx:write')
  @ApiOkResponse({ type: VersionResponseDto })
  updateTemplate(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: TemplateUpdateDto) {
    const { version: templateVersion, ...input } = dto;
    return this.commandBus.execute(new UpdateTemplateCommand(actor, params.id, templateVersion, input));
  }

  @Delete('templates/:id')
  @RequirePermissions('rx:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async deleteTemplate(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    await this.commandBus.execute(new DeleteTemplateCommand(actor, params.id));
  }

  @Get('medicines')
  @RequirePermissions('rx:read')
  @ApiOperation({ summary: "The pharmacy's active products by brand or generic name" })
  @ApiOkResponse({ type: MedicineListResponseDto })
  async medicines(@CurrentUser() actor: Actor, @Query() query: SearchQueryDto) {
    return { items: await this.queryBus.execute(new SearchMedicinesQuery(actor, query.q)) };
  }

  @Get('tests')
  @RequirePermissions('rx:read')
  @ApiOperation({ summary: 'Active diagnostic tests by name, short name or code' })
  @ApiOkResponse({ type: TestListResponseDto })
  async tests(@CurrentUser() actor: Actor, @Query() query: SearchQueryDto) {
    return { items: await this.queryBus.execute(new SearchTestsQuery(actor, query.q)) };
  }
}
