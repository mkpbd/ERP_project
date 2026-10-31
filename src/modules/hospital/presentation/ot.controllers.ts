import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Actor } from '../../../shared/application/actor.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import { createRecordController } from '../../../shared/presentation/record-controller.js';
import {
  IdParamDto,
  pageMetaShape,
  paginationShape,
  recordResponseShape,
  responseDto,
  updateSchema,
} from '../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../shared/presentation/zod/zod-dto.js';
import { HOSPITAL_RECORDS as R } from '../application/hospital.constants.js';
import {
  CancelOtCommand,
  ChangeOtCommand,
  GetOtCaseQuery,
  ListOtCasesQuery,
  MoveOtCommand,
  OtBoardQuery,
  RequestOtCommand,
  ScheduleOtCommand,
  SignOtNoteCommand,
  WriteOtNoteCommand,
} from '../application/ot.messages.js';
import { OT_CASE_STATUSES, OT_TEAM_ROLES } from '../domain/ot-case.js';

const name = (max = 100) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable();
const flag = z.enum(['true', 'false']).optional();
const search = z.string().trim().min(1).max(100).optional();
const version = z.int().min(1);
const day = z.iso.date();
const moment = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

const ot = { tag: 'operation-theatre', readPermission: 'ot:read', managePermission: 'ot:manage' } as const;

/** A named OT master (a type, an anaesthesia type): a name only. */
function namedMaster(max: number) {
  const fields = { name: name(max) };
  return {
    create: z.strictObject(fields),
    update: updateSchema(fields),
    response: recordResponseShape(fields),
  };
}

const roomFields = { name: name(100), floor: optionalText(50), description: optionalText(300), isActive: z.boolean() };
const room = {
  create: z.strictObject({
    name: roomFields.name,
    floor: roomFields.floor.default(null),
    description: roomFields.description.default(null),
    isActive: z.boolean().default(true),
  }),
  update: updateSchema(roomFields),
  response: recordResponseShape(roomFields),
};
class CreateOtRoomDto extends createZodDto(room.create) {}
class UpdateOtRoomDto extends createZodDto(room.update) {}
class OtRoomFilterDto extends createZodDto(z.object({ q: search, isActive: flag })) {}
class OtRoomResponseDto extends responseDto(room.response) {}

/** Old Hospital.OTRoom. */
export const OtRoomsController = createRecordController({
  ...ot,
  className: 'OtRoomsController',
  path: 'hospital/ot-rooms',
  type: R.otRoom,
  label: 'OT room',
  create: CreateOtRoomDto,
  update: UpdateOtRoomDto,
  response: OtRoomResponseDto,
  filter: OtRoomFilterDto,
});

const operationFields = { name: name(150), isActive: z.boolean() };
const operation = {
  create: z.strictObject({ name: operationFields.name, isActive: z.boolean().default(true) }),
  update: updateSchema(operationFields),
  response: recordResponseShape(operationFields),
};
class CreateOperationDto extends createZodDto(operation.create) {}
class UpdateOperationDto extends createZodDto(operation.update) {}
class OperationFilterDto extends createZodDto(z.object({ q: search, isActive: flag })) {}
class OperationResponseDto extends responseDto(operation.response) {}

/** Old Hospital.OTNames: the operations done here. */
export const OperationsController = createRecordController({
  ...ot,
  className: 'OperationsController',
  path: 'hospital/operations',
  type: R.operation,
  label: 'operation',
  create: CreateOperationDto,
  update: UpdateOperationDto,
  response: OperationResponseDto,
  filter: OperationFilterDto,
});

const otType = namedMaster(100);
class CreateOtTypeDto extends createZodDto(otType.create) {}
class UpdateOtTypeDto extends createZodDto(otType.update) {}
class OtTypeFilterDto extends createZodDto(z.object({ q: search })) {}
class OtTypeResponseDto extends responseDto(otType.response) {}

/** Old Hospital.OTTypes. */
export const OtTypesController = createRecordController({
  ...ot,
  className: 'OtTypesController',
  path: 'hospital/ot-types',
  type: R.otType,
  label: 'OT type',
  create: CreateOtTypeDto,
  update: UpdateOtTypeDto,
  response: OtTypeResponseDto,
  filter: OtTypeFilterDto,
});

const anaesthesia = namedMaster(100);
class CreateAnaesthesiaTypeDto extends createZodDto(anaesthesia.create) {}
class UpdateAnaesthesiaTypeDto extends createZodDto(anaesthesia.update) {}
class AnaesthesiaTypeFilterDto extends createZodDto(z.object({ q: search })) {}
class AnaesthesiaTypeResponseDto extends responseDto(anaesthesia.response) {}

/** Old Hospital.AnaesthesiaTypes. */
export const AnaesthesiaTypesController = createRecordController({
  ...ot,
  className: 'AnaesthesiaTypesController',
  path: 'hospital/anaesthesia-types',
  type: R.anaesthesiaType,
  label: 'anaesthesia type',
  create: CreateAnaesthesiaTypeDto,
  update: UpdateAnaesthesiaTypeDto,
  response: AnaesthesiaTypeResponseDto,
  filter: AnaesthesiaTypeFilterDto,
});

const procedureFields = { title: name(200), area: optionalText(100), description: optionalText(8000) };
const procedure = {
  create: z.strictObject({
    title: procedureFields.title,
    area: procedureFields.area.default(null),
    description: procedureFields.description.default(null),
  }),
  update: updateSchema(procedureFields),
  response: recordResponseShape(procedureFields),
};
class CreateSurgeryProcedureDto extends createZodDto(procedure.create) {}
class UpdateSurgeryProcedureDto extends createZodDto(procedure.update) {}
class SurgeryProcedureFilterDto extends createZodDto(z.object({ q: search })) {}
class SurgeryProcedureResponseDto extends responseDto(procedure.response) {}

/** Old Hospital.SurgeryProcedures: written steps to copy into an operation note. */
export const SurgeryProceduresController = createRecordController({
  ...ot,
  className: 'SurgeryProceduresController',
  path: 'hospital/surgery-procedures',
  type: R.surgeryProcedure,
  label: 'surgery procedure',
  create: CreateSurgeryProcedureDto,
  update: UpdateSurgeryProcedureDto,
  response: SurgeryProcedureResponseDto,
  filter: SurgeryProcedureFilterDto,
});

const clinical = {
  operationId: z.uuid(),
  otTypeId: z.uuid().nullable().default(null),
  anaesthesiaTypeId: z.uuid().nullable().default(null),
  surgeonId: z.uuid(),
  anaesthetistId: z.uuid().nullable().default(null),
  indication: optionalText(500).default(null),
  team: z
    .array(z.strictObject({ doctorId: z.uuid(), role: z.enum(OT_TEAM_ROLES) }))
    .max(10)
    .default([]),
};
class RequestOtDto extends createZodDto(z.strictObject({ admissionId: z.uuid(), requestedFor: day, ...clinical })) {}
class ChangeOtDto extends createZodDto(z.strictObject({ version, ...clinical })) {}
class ScheduleOtDto extends createZodDto(z.strictObject({ version, roomId: z.uuid(), from: moment, to: moment })) {}
class MoveOtDto extends createZodDto(z.strictObject({ version, at: moment.nullable().default(null) })) {}
class CancelOtDto extends createZodDto(z.strictObject({ version, reason: name(300) })) {}
const noteText = (max: number) => z.string().max(max).nullable().default(null);
class OtNoteDto extends createZodDto(
  z.strictObject({
    version,
    incision: noteText(500),
    findings: noteText(8000),
    procedureDone: noteText(8000),
    specimen: noteText(1000),
    postOpOrders: noteText(4000),
  }),
) {}
class SignOtNoteDto extends createZodDto(z.strictObject({ version })) {}
class OtListQueryDto extends createZodDto(
  z.object({
    ...paginationShape,
    status: z.enum(OT_CASE_STATUSES).optional(),
    from: day.optional(),
    to: day.optional(),
    roomId: z.uuid().optional(),
    surgeonId: z.uuid().optional(),
    admissionId: z.uuid().optional(),
  }),
) {}
class OtBoardQueryDto extends createZodDto(z.object({ day })) {}

const summaryShape = {
  id: z.uuid(),
  number: z.string(),
  status: z.enum(OT_CASE_STATUSES),
  admissionId: z.uuid(),
  admissionNumber: z.string(),
  patientId: z.uuid(),
  uhid: z.int(),
  patientName: z.string(),
  operationName: z.string(),
  surgeonName: z.string(),
  requestedFor: z.string(),
  otRoomId: z.uuid().nullable(),
  otRoomName: z.string().nullable(),
  scheduledFrom: z.date().nullable(),
  scheduledTo: z.date().nullable(),
};
class OtCreatedResponseDto extends responseDto({ id: z.uuid(), number: z.string() }) {}
class OtVersionResponseDto extends responseDto({ version: z.int() }) {}
class OtPageResponseDto extends responseDto({ items: z.array(z.object(summaryShape)), ...pageMetaShape }) {}
class OtCaseResponseDto extends responseDto({
  ...summaryShape,
  operationId: z.uuid(),
  otTypeId: z.uuid().nullable(),
  otTypeName: z.string().nullable(),
  anaesthesiaTypeId: z.uuid().nullable(),
  anaesthesiaTypeName: z.string().nullable(),
  surgeonId: z.uuid(),
  anaesthetistId: z.uuid().nullable(),
  anaesthetistName: z.string().nullable(),
  indication: z.string().nullable(),
  team: z.array(z.object({ doctorId: z.uuid(), doctorName: z.string(), role: z.enum(OT_TEAM_ROLES) })),
  startedAt: z.date().nullable(),
  endedAt: z.date().nullable(),
  cancelReason: z.string().nullable(),
  incision: z.string().nullable(),
  findings: z.string().nullable(),
  procedureDone: z.string().nullable(),
  specimen: z.string().nullable(),
  postOpOrders: z.string().nullable(),
  noteSignedAt: z.date().nullable(),
  noteSignedByName: z.string().nullable(),
  charges: z.array(
    z.object({
      id: z.uuid(),
      serviceName: z.string(),
      doctorName: z.string().nullable(),
      qty: z.int(),
      rate: z.number(),
      amount: z.number(),
      status: z.enum(['active', 'cancelled']),
    }),
  ),
  chargedTotal: z.number(),
  version: z.int(),
}) {}
class OtBoardResponseDto extends responseDto({
  day: z.string(),
  rooms: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      floor: z.string().nullable(),
      cases: z.array(z.object(summaryShape)),
    }),
  ),
  waiting: z.array(z.object(summaryShape)),
}) {}

/**
 * The operation theatre (step 15a): operations of admitted patients from request to done, their rooms and times, the
 * operation note. Charges for an operation are the stay's charges (POST /hospital/admissions/:id/charges with
 * otCaseId).
 */
@ApiTags('operation-theatre')
@ApiBearerAuth()
@Controller({ path: 'hospital', version: '1' })
export class OtCasesController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('ot-board')
  @RequirePermissions('ot:read')
  @ApiOperation({ summary: "Each OT room's operations on a day, and the operations waiting for a room" })
  @ApiOkResponse({ type: OtBoardResponseDto })
  board(@CurrentUser() actor: Actor, @Query() query: OtBoardQueryDto) {
    return this.queryBus.execute(new OtBoardQuery(actor, query.day));
  }

  @Get('ot-cases')
  @RequirePermissions('ot:read')
  @ApiOkResponse({ type: OtPageResponseDto })
  list(@CurrentUser() actor: Actor, @Query() query: OtListQueryDto) {
    return this.queryBus.execute(new ListOtCasesQuery(actor, query));
  }

  @Get('ot-cases/:id')
  @RequirePermissions('ot:read')
  @ApiOkResponse({ type: OtCaseResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetOtCaseQuery(actor, params.id));
  }

  @Post('ot-cases')
  @RequirePermissions('ot:request')
  @ApiOperation({ summary: 'Ask for an operation for an admitted patient, on a day from today' })
  @ApiCreatedResponse({ type: OtCreatedResponseDto })
  request(@CurrentUser() actor: Actor, @Body() dto: RequestOtDto) {
    const { admissionId, requestedFor, ...input } = dto;
    return this.commandBus.execute(new RequestOtCommand(actor, admissionId, requestedFor, input));
  }

  @Put('ot-cases/:id')
  @RequirePermissions('ot:request')
  @ApiOperation({ summary: 'Change the operation, its type, anaesthesia, surgeon, anaesthetist and team' })
  @ApiOkResponse({ type: OtVersionResponseDto })
  change(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: ChangeOtDto) {
    const { version: seen, ...input } = dto;
    return this.commandBus.execute(new ChangeOtCommand(actor, params.id, seen, input));
  }

  @Post('ot-cases/:id/schedule')
  @RequirePermissions('ot:schedule')
  @ApiOperation({ summary: 'A room and a time no other operation in the room overlaps (409 room_taken)' })
  @ApiOkResponse({ type: OtVersionResponseDto })
  schedule(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: ScheduleOtDto) {
    return this.commandBus.execute(new ScheduleOtCommand(actor, params.id, dto.version, dto.roomId, dto.from, dto.to));
  }

  @Post('ot-cases/:id/start')
  @RequirePermissions('ot:schedule')
  @ApiOkResponse({ type: OtVersionResponseDto })
  start(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: MoveOtDto) {
    return this.commandBus.execute(new MoveOtCommand(actor, params.id, dto.version, 'start', dto.at));
  }

  @Post('ot-cases/:id/finish')
  @RequirePermissions('ot:schedule')
  @ApiOkResponse({ type: OtVersionResponseDto })
  finish(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: MoveOtDto) {
    return this.commandBus.execute(new MoveOtCommand(actor, params.id, dto.version, 'finish', dto.at));
  }

  @Post('ot-cases/:id/cancel')
  @RequirePermissions('ot:schedule')
  @ApiOperation({ summary: 'Cancel an operation not under way, with a reason' })
  @ApiOkResponse({ type: OtVersionResponseDto })
  cancel(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: CancelOtDto) {
    return this.commandBus.execute(new CancelOtCommand(actor, params.id, dto.version, dto.reason));
  }

  @Put('ot-cases/:id/note')
  @RequirePermissions('ot:note')
  @ApiOperation({
    summary: 'The operation note (incision, findings, procedure, specimen, post-op orders) until signed',
  })
  @ApiOkResponse({ type: OtVersionResponseDto })
  note(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: OtNoteDto) {
    const { version: seen, ...note } = dto;
    return this.commandBus.execute(new WriteOtNoteCommand(actor, params.id, seen, note));
  }

  @Post('ot-cases/:id/note/sign')
  @RequirePermissions('ot:note')
  @ApiOperation({ summary: 'Sign the operation note: the surgeon only, once the operation is done' })
  @ApiOkResponse({ type: OtVersionResponseDto })
  sign(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: SignOtNoteDto) {
    return this.commandBus.execute(new SignOtNoteCommand(actor, params.id, dto.version));
  }
}

export const OT_CONTROLLERS = [
  OtRoomsController,
  OperationsController,
  OtTypesController,
  AnaesthesiaTypesController,
  SurgeryProceduresController,
  OtCasesController,
];
