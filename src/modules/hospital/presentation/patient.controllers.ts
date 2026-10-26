import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import type { Actor } from '../../../shared/application/actor.js';
import { ValidationError } from '../../../shared/domain/errors.js';
import { IMAGE_TYPES } from '../../../shared/domain/file-types.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import {
  IdParamDto,
  pageMetaShape,
  paginationShape,
  responseDto,
} from '../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../shared/presentation/zod/zod-dto.js';
import {
  ChangePatientCommand,
  DeactivatePatientCommand,
  FindPatientMatchesQuery,
  GetPatientByUhidQuery,
  GetPatientPhotoQuery,
  GetPatientQuery,
  ListPatientsQuery,
  ReactivatePatientCommand,
  RegisterPatientCommand,
  RemovePatientPhotoCommand,
  SetPatientPhotoCommand,
} from '../application/patient.messages.js';
import { BLOOD_GROUPS, ID_TYPES, MARITAL_STATUSES, SEXES } from '../domain/patient.js';

const day = z.iso.date();
const version = z.int().min(1);
const optional = (max: number) => z.string().max(max).nullable().default(null);

const patientShape = {
  title: optional(20),
  fullName: z.string().trim().min(1).max(150),
  sex: z.enum(SEXES),
  dateOfBirth: day.nullable().default(null),
  age: z
    .strictObject({
      years: z.int().min(0).max(130),
      months: z.int().min(0).max(1_560),
      days: z.int().min(0).max(47_000),
    })
    .nullable()
    .default(null),
  bloodGroup: z.enum(BLOOD_GROUPS).nullable().default(null),
  maritalStatus: z.enum(MARITAL_STATUSES).nullable().default(null),
  religion: optional(50),
  occupation: optional(100),
  fatherName: optional(150),
  motherName: optional(150),
  spouseName: optional(150),
  /** May be left out when the contact person's mobile is given (a newborn, an emergency). */
  mobileNo: z.string().trim().min(1).max(20).nullable().default(null),
  email: z.email().max(254).nullable().default(null),
  idType: z.enum(ID_TYPES).nullable().default(null),
  idNo: optional(40),
  careOf: optional(150),
  houseNo: optional(50),
  roadNo: optional(50),
  village: optional(100),
  postOffice: optional(100),
  area: optional(100),
  districtId: z.uuid().nullable().default(null),
  contactName: optional(150),
  contactRelation: optional(50),
  contactMobileNo: z.string().max(20).nullable().default(null),
  contactAddress: optional(300),
  specialAlert: optional(300),
  confidential: z.boolean().default(false),
};

class RegisterPatientDto extends createZodDto(
  z.strictObject({ ...patientShape, allowDuplicate: z.boolean().default(false) }),
) {}
class ChangePatientDto extends createZodDto(z.strictObject({ ...patientShape, version })) {}
class DeactivatePatientDto extends createZodDto(
  z.strictObject({ version, reason: z.string().trim().min(1).max(300) }),
) {}
class PatientVersionDto extends createZodDto(z.strictObject({ version })) {}
class PatientListQueryDto extends createZodDto(
  z.object({
    ...paginationShape,
    q: z.string().trim().max(150).optional(),
    from: day.optional(),
    to: day.optional(),
    status: z.enum(['active', 'inactive', 'all']).optional(),
  }),
) {}
class PatientMatchQueryDto extends createZodDto(
  z.object({
    mobileNo: z.string().trim().min(1).max(20),
    fullName: z.string().trim().max(150).default(''),
    dateOfBirth: day.optional(),
  }),
) {}
class UhidParamDto extends createZodDto(z.object({ uhid: z.string().trim().min(1).max(20) })) {}

const ageShape = z.object({ years: z.int(), months: z.int(), days: z.int() });
const summaryShape = {
  id: z.uuid(),
  uhid: z.int(),
  title: z.string().nullable(),
  fullName: z.string(),
  sex: z.enum(SEXES),
  dateOfBirth: z.string(),
  birthEstimated: z.boolean(),
  age: ageShape,
  uhidLabel: z.string(),
  mobileNo: z.string().nullable(),
  contactMobileNo: z.string().nullable(),
  registeredOn: z.string(),
  confidential: z.boolean(),
  isActive: z.boolean(),
};
class RegisteredPatientResponseDto extends responseDto({ id: z.uuid(), uhid: z.int() }) {}
class PatientPageResponseDto extends responseDto({ items: z.array(z.object(summaryShape)), ...pageMetaShape }) {}
class PatientMatchesResponseDto extends createZodDto(
  z.array(
    z.object({
      id: z.uuid(),
      uhid: z.int(),
      fullName: z.string(),
      dateOfBirth: z.string(),
      mobileNo: z.string().nullable(),
      contactMobileNo: z.string().nullable(),
    }),
  ),
) {}
class PatientResponseDto extends responseDto({
  ...summaryShape,
  bloodGroup: z.enum(BLOOD_GROUPS).nullable(),
  maritalStatus: z.enum(MARITAL_STATUSES).nullable(),
  religion: z.string().nullable(),
  occupation: z.string().nullable(),
  fatherName: z.string().nullable(),
  motherName: z.string().nullable(),
  spouseName: z.string().nullable(),
  email: z.string().nullable(),
  idType: z.enum(ID_TYPES).nullable(),
  idNo: z.string().nullable(),
  careOf: z.string().nullable(),
  houseNo: z.string().nullable(),
  roadNo: z.string().nullable(),
  village: z.string().nullable(),
  postOffice: z.string().nullable(),
  area: z.string().nullable(),
  districtId: z.uuid().nullable(),
  districtName: z.string().nullable(),
  contactName: z.string().nullable(),
  contactRelation: z.string().nullable(),
  contactAddress: z.string().nullable(),
  specialAlert: z.string().nullable(),
  registeredBy: z.uuid().nullable(),
  inactiveReason: z.string().nullable(),
  hasPhoto: z.boolean(),
  version: z.int(),
}) {}

function bytes(body: unknown): Buffer {
  if (!Buffer.isBuffer(body))
    throw new ValidationError(`Send the photo bytes with Content-Type ${IMAGE_TYPES.join(', ')}`);
  return body;
}

@ApiTags('hospital')
@ApiBearerAuth()
@Controller({ path: 'hospital/patients', version: '1' })
export class PatientsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @RequirePermissions('patient:read')
  @ApiOperation({ summary: 'Search patients by UHID, mobile number or name; newest registrations first' })
  @ApiOkResponse({ type: PatientPageResponseDto })
  list(@CurrentUser() actor: Actor, @Query() query: PatientListQueryDto) {
    return this.queryBus.execute(new ListPatientsQuery(actor, query));
  }

  @Get('matches')
  @RequirePermissions('patient:read')
  @ApiOperation({
    summary: 'Patients on the same mobile with the same name or date of birth (check before registering)',
  })
  @ApiOkResponse({ type: PatientMatchesResponseDto })
  matches(@CurrentUser() actor: Actor, @Query() query: PatientMatchQueryDto) {
    return this.queryBus.execute(
      new FindPatientMatchesQuery(actor, query.mobileNo, query.fullName, query.dateOfBirth ?? null),
    );
  }

  @Get('uhid/:uhid')
  @RequirePermissions('patient:read')
  @ApiOperation({ summary: 'The patient of a UHID, as typed or scanned (a prefix such as FKH is ignored)' })
  @ApiOkResponse({ type: PatientResponseDto })
  byUhid(@CurrentUser() actor: Actor, @Param() params: UhidParamDto) {
    return this.queryBus.execute(new GetPatientByUhidQuery(actor, params.uhid));
  }

  @Get(':id')
  @RequirePermissions('patient:read')
  @ApiOkResponse({ type: PatientResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetPatientQuery(actor, params.id));
  }

  @Post()
  @RequirePermissions('patient:register')
  @ApiOperation({
    summary: 'Register a patient and give a UHID (date of birth or age; 409 possible_duplicate unless allowDuplicate)',
  })
  @ApiCreatedResponse({ type: RegisteredPatientResponseDto })
  register(@CurrentUser() actor: Actor, @Body() dto: RegisterPatientDto) {
    const { allowDuplicate, ...input } = dto;
    return this.commandBus.execute(new RegisterPatientCommand(actor, input, allowDuplicate));
  }

  @Put(':id')
  @RequirePermissions('patient:register')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Replace the patient's details (the UHID never changes)" })
  @ApiNoContentResponse()
  async change(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: ChangePatientDto) {
    const { version: patientVersion, ...input } = dto;
    await this.commandBus.execute(new ChangePatientCommand(actor, params.id, patientVersion, input));
  }

  @Post(':id/deactivate')
  @RequirePermissions('patient:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Take a record out of use (registered twice, made by mistake); its UHID is never reused' })
  @ApiNoContentResponse()
  async deactivate(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: DeactivatePatientDto) {
    await this.commandBus.execute(new DeactivatePatientCommand(actor, params.id, dto.version, dto.reason));
  }

  @Post(':id/reactivate')
  @RequirePermissions('patient:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async reactivate(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: PatientVersionDto) {
    await this.commandBus.execute(new ReactivatePatientCommand(actor, params.id, dto.version));
  }

  @Get(':id/photo')
  @RequirePermissions('patient:read')
  @ApiProduces(...IMAGE_TYPES)
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async photo(@CurrentUser() actor: Actor, @Param() params: IdParamDto): Promise<StreamableFile> {
    const photo = await this.queryBus.execute(new GetPatientPhotoQuery(actor, params.id));
    return new StreamableFile(photo.data, { type: photo.contentType, disposition: 'inline' });
  }

  @Put(':id/photo')
  @RequirePermissions('patient:register')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Upload the photo as the raw body (PNG, JPEG or WebP, up to 1 MiB)' })
  @ApiConsumes(...IMAGE_TYPES)
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ApiNoContentResponse()
  async setPhoto(
    @CurrentUser() actor: Actor,
    @Param() params: IdParamDto,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
  ): Promise<void> {
    await this.commandBus.execute(new SetPatientPhotoCommand(actor, params.id, contentType ?? '', bytes(body)));
  }

  @Delete(':id/photo')
  @RequirePermissions('patient:register')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async removePhoto(@CurrentUser() actor: Actor, @Param() params: IdParamDto): Promise<void> {
    await this.commandBus.execute(new RemovePatientPhotoCommand(actor, params.id));
  }
}

export const PATIENT_CONTROLLERS = [PatientsController];
