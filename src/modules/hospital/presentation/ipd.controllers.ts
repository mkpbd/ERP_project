import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
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
  pageMetaShape,
  paginationShape,
  recordResponseShape,
  responseDto,
  updateSchema,
} from '../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../shared/presentation/zod/zod-dto.js';
import { HOSPITAL_RECORDS as R } from '../application/hospital.constants.js';
import {
  AdmitPatientCommand,
  ChangeAdmissionCommand,
  GetAdmissionQuery,
  GetBedBoardQuery,
  ListAdmissionsQuery,
  SetBedStatusCommand,
} from '../application/ipd.messages.js';
import { ADMISSION_KINDS, DISCHARGE_TYPES } from '../domain/admission.js';
import { PAYMENT_METHODS } from '../domain/opd-bill.js';

const name = (max = 100) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable();
const money = z.number().min(0).max(10_000_000).multipleOf(0.01);
const flag = z.enum(['true', 'false']).optional();
const search = z.string().trim().min(1).max(100).optional();
const version = z.int().min(1);
const day = z.iso.date();
const BED_STATUSES = ['available', 'occupied', 'housekeeping', 'out_of_order'] as const;

const ipd = { tag: 'ipd', readPermission: 'ipd:read', managePermission: 'ipd:manage' } as const;

const wardFields = { name: name(100), floor: optionalText(50), isActive: z.boolean() };
const ward = {
  create: z.strictObject({ ...wardFields, floor: wardFields.floor.default(null), isActive: z.boolean().default(true) }),
  update: updateSchema(wardFields),
  response: recordResponseShape(wardFields),
};
class CreateWardDto extends createZodDto(ward.create) {}
class UpdateWardDto extends createZodDto(ward.update) {}
class WardFilterDto extends createZodDto(z.object({ q: search, isActive: flag })) {}
class WardResponseDto extends responseDto(ward.response) {}

const categoryFields = { name: name(100), admissionFee: money, dailyRate: money, isIntensive: z.boolean() };
const category = {
  create: z.strictObject({
    name: categoryFields.name,
    admissionFee: money.default(0),
    dailyRate: money.default(0),
    isIntensive: z.boolean().default(false),
  }),
  update: updateSchema(categoryFields),
  response: recordResponseShape(categoryFields),
};
class CreateBedCategoryDto extends createZodDto(category.create) {}
class UpdateBedCategoryDto extends createZodDto(category.update) {}
class BedCategoryFilterDto extends createZodDto(z.object({ q: search })) {}
class BedCategoryResponseDto extends responseDto(category.response) {}

const bedFields = {
  code: z.string().trim().min(1).max(20),
  wardId: z.uuid(),
  categoryId: z.uuid(),
  /** The bed's own daily rate; null takes its category's. */
  dailyRate: money.nullable(),
  displayOrder: z.int().min(0).max(10_000),
  isActive: z.boolean(),
};
const bed = {
  create: z.strictObject({
    ...bedFields,
    dailyRate: money.nullable().default(null),
    displayOrder: z.int().min(0).max(10_000).default(0),
    isActive: z.boolean().default(true),
  }),
  update: updateSchema(bedFields),
  response: recordResponseShape({ ...bedFields, status: z.enum(BED_STATUSES) }),
};
class CreateBedDto extends createZodDto(bed.create) {}
class UpdateBedDto extends createZodDto(bed.update) {}
class BedFilterDto extends createZodDto(
  z.object({
    q: search,
    wardId: z.uuid().optional(),
    categoryId: z.uuid().optional(),
    status: z.enum(BED_STATUSES).optional(),
    isActive: flag,
  }),
) {}
class BedResponseDto extends responseDto(bed.response) {}

/** Old Floors / HDepartments as places. */
export const WardsController = createRecordController({
  ...ipd,
  className: 'WardsController',
  path: 'hospital/wards',
  type: R.ward,
  label: 'ward',
  create: CreateWardDto,
  update: UpdateWardDto,
  response: WardResponseDto,
  filter: WardFilterDto,
});

/** Old Cabin Types: general ward, cabin, ICU … with the admission fee and daily rate. */
export const BedCategoriesController = createRecordController({
  ...ipd,
  className: 'BedCategoriesController',
  path: 'hospital/bed-categories',
  type: R.bedCategory,
  label: 'bed category',
  create: CreateBedCategoryDto,
  update: UpdateBedCategoryDto,
  response: BedCategoryResponseDto,
  filter: BedCategoryFilterDto,
});

/** Old Cabins: the beds; their status changes only through admissions and the bed status endpoint. */
export const BedsController = createRecordController({
  ...ipd,
  className: 'BedsController',
  path: 'hospital/beds',
  type: R.bed,
  label: 'bed',
  create: CreateBedDto,
  update: UpdateBedDto,
  response: BedResponseDto,
  filter: BedFilterDto,
});

class AdmitDto extends createZodDto(
  z.strictObject({
    patientId: z.uuid(),
    bedId: z.uuid(),
    doctorId: z.uuid(),
    additionalDoctorIds: z.array(z.uuid()).max(10).default([]),
    kind: z.enum(ADMISSION_KINDS).default('elective'),
    reason: z.string().trim().max(500).nullable().default(null),
    referredById: z.uuid().nullable().default(null),
    /** Left out: the patient's own corporate client, if any; null: the patient pays. */
    corporateClientId: z.uuid().nullable().optional(),
    staffId: z.uuid().nullable().default(null),
    /** An advance taken with the admission. */
    advance: z
      .strictObject({
        amount: money,
        method: z.enum(PAYMENT_METHODS).default('cash'),
        reference: z.string().trim().max(100).nullable().default(null),
      })
      .nullable()
      .default(null),
  }),
) {}
class TransferDto extends createZodDto(
  z.strictObject({ version, bedId: z.uuid(), reason: z.string().trim().min(1).max(200) }),
) {}
class ConsultantDto extends createZodDto(z.strictObject({ version, doctorId: z.uuid() })) {}
class AdditionalDoctorsDto extends createZodDto(z.strictObject({ version, doctorIds: z.array(z.uuid()).max(10) })) {}
class DischargeDto extends createZodDto(
  z.strictObject({
    version,
    type: z.enum(DISCHARGE_TYPES).default('normal'),
    note: z.string().trim().max(1000).nullable().default(null),
  }),
) {}
class CancelAdmissionDto extends createZodDto(z.strictObject({ version, reason: z.string().trim().min(1).max(300) })) {}
class BedStatusDto extends createZodDto(z.strictObject({ status: z.enum(['available', 'out_of_order']) })) {}
class AdmissionListQueryDto extends createZodDto(
  z.object({
    ...paginationShape,
    status: z.enum(['admitted', 'discharged', 'cancelled']).optional(),
    patientId: z.uuid().optional(),
    doctorId: z.uuid().optional(),
    wardId: z.uuid().optional(),
    from: day.optional(),
    to: day.optional(),
  }),
) {}
class BedBoardQueryDto extends createZodDto(z.object({ wardId: z.uuid().optional() })) {}

const summaryShape = {
  id: z.uuid(),
  number: z.string(),
  patientId: z.uuid(),
  uhid: z.int(),
  patientName: z.string(),
  admittedAt: z.date(),
  kind: z.enum(ADMISSION_KINDS),
  status: z.enum(['admitted', 'discharged', 'cancelled']),
  dischargedAt: z.date().nullable(),
  dischargeType: z.enum(DISCHARGE_TYPES).nullable(),
  bedCode: z.string().nullable(),
  wardName: z.string().nullable(),
  doctorName: z.string().nullable(),
  version: z.int(),
};
class AdmittedResponseDto extends responseDto({ id: z.uuid(), number: z.string(), receipt: z.string().nullable() }) {}
class AdmissionPageResponseDto extends responseDto({ items: z.array(z.object(summaryShape)), ...pageMetaShape }) {}
class AdmissionResponseDto extends responseDto({
  ...summaryShape,
  sex: z.string(),
  dateOfBirth: z.string(),
  mobileNo: z.string().nullable(),
  reason: z.string().nullable(),
  referredById: z.uuid().nullable(),
  referredByName: z.string().nullable(),
  corporateClientId: z.uuid().nullable(),
  corporateClientName: z.string().nullable(),
  staffId: z.uuid().nullable(),
  admissionFee: z.number(),
  dischargeNote: z.string().nullable(),
  cancelReason: z.string().nullable(),
  admittedBy: z.uuid().nullable(),
  closedBy: z.uuid().nullable(),
  stays: z.array(
    z.object({
      bedId: z.uuid(),
      bedCode: z.string(),
      wardName: z.string(),
      categoryName: z.string(),
      fromAt: z.date(),
      toAt: z.date().nullable(),
      dailyRate: z.number(),
      reason: z.string().nullable(),
    }),
  ),
  doctors: z.array(
    z.object({
      doctorId: z.uuid(),
      doctorName: z.string(),
      role: z.enum(['primary', 'additional']),
      fromAt: z.date(),
      toAt: z.date().nullable(),
    }),
  ),
}) {}
class BedBoardResponseDto extends responseDto({
  wards: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      floor: z.string().nullable(),
      beds: z.array(
        z.object({
          id: z.uuid(),
          code: z.string(),
          categoryName: z.string(),
          isIntensive: z.boolean(),
          status: z.enum(BED_STATUSES),
          dailyRate: z.number(),
          admission: z
            .object({
              id: z.uuid(),
              number: z.string(),
              patientName: z.string(),
              uhid: z.int(),
              since: z.date(),
              doctorName: z.string().nullable(),
            })
            .nullable(),
        }),
      ),
    }),
  ),
  counts: z.object({ available: z.int(), occupied: z.int(), housekeeping: z.int(), out_of_order: z.int() }),
}) {}

@ApiTags('ipd')
@ApiBearerAuth()
@Controller({ path: 'hospital', version: '1' })
export class AdmissionsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('bed-board')
  @RequirePermissions('ipd:read')
  @ApiOperation({ summary: 'Every bed by ward, its status and who is in it' })
  @ApiOkResponse({ type: BedBoardResponseDto })
  board(@CurrentUser() actor: Actor, @Query() query: BedBoardQueryDto) {
    return this.queryBus.execute(new GetBedBoardQuery(actor, query.wardId));
  }

  @Post('beds/:id/status')
  @RequirePermissions('ipd:admit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'A bed ready after housekeeping, or out of order (ipd:manage); never one with a patient' })
  @ApiNoContentResponse()
  async bedStatus(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: BedStatusDto) {
    await this.commandBus.execute(new SetBedStatusCommand(actor, params.id, dto.status));
  }

  @Get('admissions')
  @RequirePermissions('ipd:read')
  @ApiOkResponse({ type: AdmissionPageResponseDto })
  list(@CurrentUser() actor: Actor, @Query() query: AdmissionListQueryDto) {
    return this.queryBus.execute(new ListAdmissionsQuery(actor, query));
  }

  @Get('admissions/:id')
  @RequirePermissions('ipd:read')
  @ApiOkResponse({ type: AdmissionResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetAdmissionQuery(actor, params.id));
  }

  @Post('admissions')
  @RequirePermissions('ipd:admit')
  @ApiOperation({
    summary: 'Admit a registered patient with no open admission to a free bed under a consultant (with an advance)',
  })
  @ApiCreatedResponse({ type: AdmittedResponseDto })
  admit(@CurrentUser() actor: Actor, @Body() dto: AdmitDto) {
    return this.commandBus.execute(new AdmitPatientCommand(actor, dto));
  }

  @Post('admissions/:id/transfer')
  @RequirePermissions('ipd:admit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Move the patient to another free bed, with a reason; the bed left goes to housekeeping' })
  @ApiNoContentResponse()
  async transfer(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: TransferDto) {
    await this.commandBus.execute(
      new ChangeAdmissionCommand(actor, params.id, dto.version, {
        kind: 'transfer',
        bedId: dto.bedId,
        reason: dto.reason,
      }),
    );
  }

  @Post('admissions/:id/consultant')
  @RequirePermissions('ipd:admit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async consultant(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: ConsultantDto) {
    await this.commandBus.execute(
      new ChangeAdmissionCommand(actor, params.id, dto.version, { kind: 'consultant', doctorId: dto.doctorId }),
    );
  }

  @Post('admissions/:id/additional-doctors')
  @RequirePermissions('ipd:admit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'The doctors who also see the patient (the whole list)' })
  @ApiNoContentResponse()
  async additional(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: AdditionalDoctorsDto) {
    await this.commandBus.execute(
      new ChangeAdmissionCommand(actor, params.id, dto.version, { kind: 'additional', doctorIds: dto.doctorIds }),
    );
  }

  @Post('admissions/:id/discharge')
  @RequirePermissions('ipd:admit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Discharge (normal, LAMA, referred, absconded, death — a note for all but normal) on the day of the final bill',
  })
  @ApiNoContentResponse()
  async discharge(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: DischargeDto) {
    await this.commandBus.execute(
      new ChangeAdmissionCommand(actor, params.id, dto.version, { kind: 'discharge', type: dto.type, note: dto.note }),
    );
  }

  @Post('admissions/:id/cancel')
  @RequirePermissions('ipd:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel an admission made by mistake, with a reason' })
  @ApiNoContentResponse()
  async cancel(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: CancelAdmissionDto) {
    await this.commandBus.execute(
      new ChangeAdmissionCommand(actor, params.id, dto.version, { kind: 'cancel', reason: dto.reason }),
    );
  }
}

export const IPD_CONTROLLERS = [WardsController, BedCategoriesController, BedsController, AdmissionsController];
