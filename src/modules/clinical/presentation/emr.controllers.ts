import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
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
import { createRecordController } from '../../../shared/presentation/record-controller.js';
import {
  IdParamDto,
  recordResponseShape,
  responseDto,
  updateSchema,
} from '../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../shared/presentation/zod/zod-dto.js';
import {
  AcknowledgeHandoverCommand,
  CLINICAL_RECORDS,
  CorrectNoteCommand,
  GetRecordsQuery,
  ListNotesQuery,
  PendingHandoversQuery,
  RecordBirthCommand,
  RecordDeathCommand,
  VoidRecordCommand,
  WriteNoteCommand,
} from '../application/emr.messages.js';
import { DELIVERY_MODES, NOTE_KINDS } from '../domain/emr.js';

const version = z.int().min(1);
const moment = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const note = (max: number) => z.string().max(max).nullable().default(null);

const templateFields = {
  name: z.string().trim().min(1).max(100),
  kind: z.enum(NOTE_KINDS),
  body: z.string().trim().min(1).max(8000),
  isActive: z.boolean(),
};
class CreateNoteTemplateDto extends createZodDto(
  z.strictObject({ ...templateFields, isActive: z.boolean().default(true) }),
) {}
class UpdateNoteTemplateDto extends createZodDto(updateSchema(templateFields)) {}
class NoteTemplateFilterDto extends createZodDto(
  z.object({
    q: z.string().trim().min(1).max(100).optional(),
    kind: z.enum(NOTE_KINDS).optional(),
    isActive: z.enum(['true', 'false']).optional(),
  }),
) {}
class NoteTemplateResponseDto extends responseDto(recordResponseShape(templateFields)) {}

/** Old OTTemplate and the special order forms: the text a note starts from. */
export const NoteTemplatesController = createRecordController({
  tag: 'clinical',
  readPermission: 'rx:read',
  managePermission: 'rx:manage',
  className: 'NoteTemplatesController',
  path: 'clinical/note-templates',
  type: CLINICAL_RECORDS.noteTemplate,
  label: 'note template',
  create: CreateNoteTemplateDto,
  update: UpdateNoteTemplateDto,
  response: NoteTemplateResponseDto,
  filter: NoteTemplateFilterDto,
});

class AdmissionParamDto extends createZodDto(z.object({ admissionId: z.uuid() })) {}
class NoteDto extends createZodDto(
  z.strictObject({
    kind: z.enum(NOTE_KINDS),
    note: z.string().max(8000),
    doctorId: z.uuid().nullable().default(null),
    notedAt: moment.nullable().default(null),
    handedTo: z.uuid().nullable().default(null),
  }),
) {}
class CorrectNoteDto extends createZodDto(z.strictObject({ version, note: z.string().max(8000) })) {}
class NoteQueryDto extends createZodDto(z.object({ kind: z.enum(NOTE_KINDS).optional() })) {}
class DeathDto extends createZodDto(
  z.strictObject({
    doctorId: z.uuid(),
    diedAt: moment,
    cause: z.string().max(500),
    antecedentCause: note(500),
    otherConditions: note(1000),
    deceasedNid: note(17),
    guardianName: note(150),
    guardianNid: note(17),
    guardianRelation: note(50),
    familyContactNo: note(11),
  }),
) {}
class BirthDto extends createZodDto(
  z.strictObject({
    doctorId: z.uuid(),
    childName: note(150),
    childSex: z.enum(['male', 'female', 'other']),
    bornAt: moment,
    deliveryMode: z.enum(DELIVERY_MODES),
    birthWeightKg: z.number(),
    fatherName: note(150),
    grandfatherName: note(150),
    religion: note(50),
    fatherPresentAddress: note(300),
    fatherPermanentAddress: note(300),
    comments: note(1000),
  }),
) {}
class VoidDto extends createZodDto(z.strictObject({ version, reason: z.string().max(300) })) {}

const noteShape = {
  id: z.uuid(),
  admissionId: z.uuid(),
  kind: z.enum(NOTE_KINDS),
  doctorId: z.uuid().nullable(),
  doctorName: z.string().nullable(),
  notedAt: z.date(),
  note: z.string(),
  handedTo: z.uuid().nullable(),
  handedToName: z.string().nullable(),
  acknowledgedAt: z.date().nullable(),
  writtenBy: z.uuid(),
  writerName: z.string(),
  version: z.int(),
  createdAt: z.date(),
  updatedAt: z.date(),
};
const recordBase = {
  id: z.uuid(),
  number: z.string(),
  admissionId: z.uuid(),
  doctorId: z.uuid(),
  recordedBy: z.uuid(),
  voidedAt: z.date().nullable(),
  voidReason: z.string().nullable(),
  version: z.int(),
  createdAt: z.date(),
};
const deathShape = z.object({
  ...recordBase,
  patientId: z.uuid(),
  diedAt: z.date(),
  cause: z.string(),
  antecedentCause: z.string().nullable(),
  otherConditions: z.string().nullable(),
  deceasedNid: z.string().nullable(),
  guardianName: z.string().nullable(),
  guardianNid: z.string().nullable(),
  guardianRelation: z.string().nullable(),
  familyContactNo: z.string().nullable(),
});
const birthShape = z.object({
  ...recordBase,
  motherId: z.uuid(),
  childName: z.string().nullable(),
  childSex: z.enum(['male', 'female', 'other']),
  bornAt: z.date(),
  deliveryMode: z.enum(DELIVERY_MODES),
  birthWeightKg: z.number(),
  fatherName: z.string().nullable(),
  grandfatherName: z.string().nullable(),
  religion: z.string().nullable(),
  fatherPresentAddress: z.string().nullable(),
  fatherPermanentAddress: z.string().nullable(),
  comments: z.string().nullable(),
});

class IdResponseDto extends responseDto({ id: z.uuid() }) {}
class NumberedResponseDto extends responseDto({ id: z.uuid(), number: z.string() }) {}
class VersionResponseDto extends responseDto({ version: z.int() }) {}
class NoteListResponseDto extends responseDto({ items: z.array(z.object(noteShape)) }) {}
class HandoverListResponseDto extends responseDto({
  items: z.array(z.object({ ...noteShape, admissionNumber: z.string(), patientName: z.string() })),
}) {}
class RecordsResponseDto extends responseDto({ death: deathShape.nullable(), births: z.array(birthShape) }) {}

@ApiTags('clinical')
@ApiBearerAuth()
@Controller({ path: 'clinical', version: '1' })
export class EmrController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('admissions/:admissionId/notes')
  @RequirePermissions('emr:read')
  @ApiOperation({ summary: "The admitted patient's notes, oldest first" })
  @ApiOkResponse({ type: NoteListResponseDto })
  async notes(@CurrentUser() actor: Actor, @Param() params: AdmissionParamDto, @Query() query: NoteQueryDto) {
    return { items: await this.queryBus.execute(new ListNotesQuery(actor, params.admissionId, query.kind)) };
  }

  @Post('admissions/:admissionId/notes')
  @RequirePermissions('emr:write')
  @ApiOperation({
    summary:
      'A round or consultation (names the doctor), procedure, transfer, ICU or handover note (names who takes over)',
  })
  @ApiCreatedResponse({ type: IdResponseDto })
  write(@CurrentUser() actor: Actor, @Param() params: AdmissionParamDto, @Body() dto: NoteDto) {
    return this.commandBus.execute(new WriteNoteCommand(actor, params.admissionId, dto));
  }

  @Put('notes/:id')
  @RequirePermissions('emr:write')
  @ApiOperation({ summary: 'Corrected by its writer within 24 hours' })
  @ApiOkResponse({ type: VersionResponseDto })
  correct(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: CorrectNoteDto) {
    return this.commandBus.execute(new CorrectNoteCommand(actor, params.id, dto.version, dto.note));
  }

  @Get('handovers/pending')
  @RequirePermissions('emr:read')
  @ApiOperation({ summary: 'Handovers to the signed-in user not acknowledged yet' })
  @ApiOkResponse({ type: HandoverListResponseDto })
  async pending(@CurrentUser() actor: Actor) {
    return { items: await this.queryBus.execute(new PendingHandoversQuery(actor)) };
  }

  @Post('notes/:id/acknowledge')
  @RequirePermissions('emr:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async acknowledge(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    await this.commandBus.execute(new AcknowledgeHandoverCommand(actor, params.id));
  }

  @Get('admissions/:admissionId/records')
  @RequirePermissions('emr:read')
  @ApiOperation({ summary: 'The death record in force and the births (voided ones too)' })
  @ApiOkResponse({ type: RecordsResponseDto })
  records(@CurrentUser() actor: Actor, @Param() params: AdmissionParamDto) {
    return this.queryBus.execute(new GetRecordsQuery(actor, params.admissionId));
  }

  @Post('admissions/:admissionId/death-record')
  @RequirePermissions('emr:certify')
  @ApiCreatedResponse({ type: NumberedResponseDto })
  death(@CurrentUser() actor: Actor, @Param() params: AdmissionParamDto, @Body() dto: DeathDto) {
    const { doctorId, ...details } = dto;
    return this.commandBus.execute(new RecordDeathCommand(actor, params.admissionId, doctorId, details));
  }

  @Post('admissions/:admissionId/birth-records')
  @RequirePermissions('emr:certify')
  @ApiOperation({ summary: 'A child born to the admitted mother (one record per child)' })
  @ApiCreatedResponse({ type: NumberedResponseDto })
  birth(@CurrentUser() actor: Actor, @Param() params: AdmissionParamDto, @Body() dto: BirthDto) {
    const { doctorId, ...details } = dto;
    return this.commandBus.execute(new RecordBirthCommand(actor, params.admissionId, doctorId, details));
  }

  @Post('death-records/:id/void')
  @RequirePermissions('emr:certify')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async voidDeath(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: VoidDto) {
    await this.commandBus.execute(new VoidRecordCommand(actor, 'death', params.id, dto.version, dto.reason));
  }

  @Post('birth-records/:id/void')
  @RequirePermissions('emr:certify')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async voidBirth(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: VoidDto) {
    await this.commandBus.execute(new VoidRecordCommand(actor, 'birth', params.id, dto.version, dto.reason));
  }
}

export const EMR_CONTROLLERS = [NoteTemplatesController, EmrController];
