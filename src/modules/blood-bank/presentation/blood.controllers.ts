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
import {
  CancelRequestCommand,
  CrossmatchCommand,
  DiscardUnitCommand,
  GetDonationQuery,
  GetRequestQuery,
  IssueBloodCommand,
  ListDonorsQuery,
  ListRequestsQuery,
  ListUnitsQuery,
  PrepareComponentsCommand,
  RegisterDonorCommand,
  RequestBloodCommand,
  ScreenDonationCommand,
  TakeDonationCommand,
  BLOOD_RECORDS,
} from '../application/blood.messages.js';
import { BLOOD_GROUPS } from '../domain/blood.js';

const version = z.int().min(1);
const day = z.iso.date();
const group = z.enum(BLOOD_GROUPS);
const screen = z.enum(['negative', 'positive']);
const UNIT_STATUSES = ['quarantine', 'available', 'reserved', 'issued', 'discarded'] as const;
const REQUEST_STATUSES = ['open', 'fulfilled', 'cancelled'] as const;

const componentFields = {
  name: z.string().trim().min(1).max(100),
  code: z.string().trim().min(1).max(10),
  /** Days a unit keeps from the day of donation. */
  shelfDays: z.int().min(1).max(3650),
  compatibility: z.enum(['red_cells', 'plasma', 'any']),
  /** Charged to an admitted patient's stay per unit. */
  rate: z.number().min(0).max(10_000_000).multipleOf(0.01),
  isActive: z.boolean(),
};
class CreateComponentTypeDto extends createZodDto(
  z.strictObject({ ...componentFields, rate: componentFields.rate.default(0), isActive: z.boolean().default(true) }),
) {}
class UpdateComponentTypeDto extends createZodDto(updateSchema(componentFields)) {}
class ComponentTypeFilterDto extends createZodDto(
  z.object({ q: z.string().trim().min(1).max(100).optional(), isActive: z.enum(['true', 'false']).optional() }),
) {}
class ComponentTypeResponseDto extends responseDto(recordResponseShape(componentFields)) {}

/** Old TransfusionMedicine.BloodComponents: whole blood, packed cells, platelets, plasma … */
export const ComponentTypesController = createRecordController({
  tag: 'blood-bank',
  readPermission: 'bb:read',
  managePermission: 'bb:manage',
  className: 'ComponentTypesController',
  path: 'blood-bank/component-types',
  type: BLOOD_RECORDS.componentType,
  label: 'blood component',
  create: CreateComponentTypeDto,
  update: UpdateComponentTypeDto,
  response: ComponentTypeResponseDto,
  filter: ComponentTypeFilterDto,
});

class DonorDto extends createZodDto(
  z.strictObject({
    fullName: z.string().trim().min(1).max(150),
    sex: z.enum(['male', 'female', 'other']),
    dateOfBirth: day,
    bloodGroup: group,
    mobileNo: z.string().trim().max(20).nullable().default(null),
    address: z.string().trim().max(300).nullable().default(null),
  }),
) {}
class DonationDto extends createZodDto(z.strictObject({ donorId: z.uuid(), volumeMl: z.int().min(50).max(600) })) {}
class ScreeningDto extends createZodDto(
  z.strictObject({ version, hiv: screen, hbsag: screen, hcv: screen, syphilis: screen, malaria: screen }),
) {}
class ComponentsDto extends createZodDto(z.strictObject({ componentTypeIds: z.array(z.uuid()).min(1).max(6) })) {}
class DiscardDto extends createZodDto(z.strictObject({ version, reason: z.string().trim().min(1).max(300) })) {}
class BloodRequestDto extends createZodDto(
  z.strictObject({
    patientId: z.uuid(),
    admissionId: z.uuid().nullable().default(null),
    billNumber: z.string().trim().min(1).max(30).nullable().default(null),
    componentTypeId: z.uuid(),
    units: z.int().min(1).max(20),
    reason: z.string().trim().max(300).nullable().default(null),
  }),
) {}
class CrossmatchDto extends createZodDto(
  z.strictObject({
    unitId: z.uuid(),
    result: z.enum(['compatible', 'incompatible']),
    method: z.string().trim().max(100).nullable().default(null),
  }),
) {}
class IssueDto extends createZodDto(z.strictObject({ unitId: z.uuid() })) {}
class RequestVersionDto extends createZodDto(z.strictObject({ version })) {}
class DonorListQueryDto extends createZodDto(
  z.object({ ...paginationShape, q: z.string().trim().min(1).max(100).optional(), bloodGroup: group.optional() }),
) {}
class UnitListQueryDto extends createZodDto(
  z.object({
    ...paginationShape,
    status: z.enum(UNIT_STATUSES).optional(),
    bloodGroup: group.optional(),
    componentTypeId: z.uuid().optional(),
    donationId: z.uuid().optional(),
  }),
) {}
class RequestListQueryDto extends createZodDto(
  z.object({ ...paginationShape, status: z.enum(REQUEST_STATUSES).optional(), patientId: z.uuid().optional() }),
) {}

const unitShape = {
  id: z.uuid(),
  unitNumber: z.string(),
  donationId: z.uuid(),
  bagNumber: z.string(),
  componentTypeId: z.uuid(),
  componentName: z.string(),
  bloodGroup: group,
  preparedOn: z.string(),
  expiresOn: z.string(),
  status: z.enum(UNIT_STATUSES),
  requestId: z.uuid().nullable(),
  version: z.int(),
};
const requestShape = {
  id: z.uuid(),
  number: z.string(),
  patientId: z.uuid(),
  admissionId: z.uuid().nullable(),
  billId: z.uuid().nullable(),
  componentTypeId: z.uuid(),
  componentName: z.string(),
  units: z.int(),
  issued: z.int(),
  bloodGroup: group,
  requestedOn: z.string(),
  status: z.enum(REQUEST_STATUSES),
  version: z.int(),
};
class NumberedResponseDto extends responseDto({ id: z.uuid(), number: z.string() }) {}
class DonationTakenResponseDto extends responseDto({ id: z.uuid(), bagNumber: z.string() }) {}
class ScreenedResponseDto extends responseDto({ status: z.string(), units: z.int() }) {}
class PreparedResponseDto extends responseDto({ units: z.array(z.object({ id: z.uuid(), unitNumber: z.string() })) }) {}
class CrossmatchedResponseDto extends responseDto({ result: z.enum(['compatible', 'incompatible']) }) {}
class IssuedResponseDto extends responseDto({
  id: z.uuid(),
  number: z.string(),
  amount: z.number(),
  status: z.string(),
}) {}
class CancelledResponseDto extends responseDto({ released: z.int() }) {}
class DonorPageResponseDto extends responseDto({
  items: z.array(
    z.object({
      id: z.uuid(),
      number: z.string(),
      fullName: z.string(),
      sex: z.string(),
      dateOfBirth: z.string(),
      bloodGroup: group,
      mobileNo: z.string().nullable(),
      lastDonatedOn: z.string().nullable(),
      deferredUntil: z.string().nullable(),
      isActive: z.boolean(),
    }),
  ),
  ...pageMetaShape,
}) {}
class DonationResponseDto extends responseDto({
  id: z.uuid(),
  bagNumber: z.string(),
  donorId: z.uuid(),
  donorName: z.string(),
  donatedOn: z.string(),
  bloodGroup: group,
  volumeMl: z.int(),
  status: z.enum(['collected', 'screened', 'discarded']),
  screens: z.object({
    hiv: screen.nullable(),
    hbsag: screen.nullable(),
    hcv: screen.nullable(),
    syphilis: screen.nullable(),
    malaria: screen.nullable(),
  }),
  discardReason: z.string().nullable(),
  version: z.int(),
  units: z.array(z.object(unitShape)),
}) {}
class UnitPageResponseDto extends responseDto({ items: z.array(z.object(unitShape)), ...pageMetaShape }) {}
class RequestPageResponseDto extends responseDto({ items: z.array(z.object(requestShape)), ...pageMetaShape }) {}
class BloodRequestResponseDto extends responseDto({
  ...requestShape,
  reason: z.string().nullable(),
  crossmatches: z.array(
    z.object({
      unitId: z.uuid(),
      unitNumber: z.string(),
      result: z.enum(['compatible', 'incompatible']),
      method: z.string().nullable(),
      doneAt: z.date(),
    }),
  ),
  issues: z.array(
    z.object({
      id: z.uuid(),
      number: z.string(),
      unitId: z.uuid(),
      unitNumber: z.string(),
      issuedAt: z.date(),
      amount: z.number(),
    }),
  ),
}) {}

@ApiTags('blood-bank')
@ApiBearerAuth()
@Controller({ path: 'blood-bank', version: '1' })
export class BloodBankController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('donors')
  @RequirePermissions('bb:read')
  @ApiOkResponse({ type: DonorPageResponseDto })
  donors(@CurrentUser() actor: Actor, @Query() query: DonorListQueryDto) {
    return this.queryBus.execute(new ListDonorsQuery(actor, query));
  }

  @Post('donors')
  @RequirePermissions('bb:collect')
  @ApiCreatedResponse({ type: NumberedResponseDto })
  registerDonor(@CurrentUser() actor: Actor, @Body() dto: DonorDto) {
    return this.commandBus.execute(new RegisterDonorCommand(actor, dto));
  }

  @Post('donations')
  @RequirePermissions('bb:collect')
  @ApiOperation({ summary: 'A bag taken from a donor of 18 to 65 not deferred (90 days between donations)' })
  @ApiCreatedResponse({ type: DonationTakenResponseDto })
  donate(@CurrentUser() actor: Actor, @Body() dto: DonationDto) {
    return this.commandBus.execute(new TakeDonationCommand(actor, dto.donorId, dto.volumeMl));
  }

  @Get('donations/:id')
  @RequirePermissions('bb:read')
  @ApiOkResponse({ type: DonationResponseDto })
  donation(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetDonationQuery(actor, params.id));
  }

  @Post('donations/:id/screening')
  @RequirePermissions('bb:collect')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'HIV, HBsAg, HCV, syphilis and malaria: any reactive throws the donation and its units away',
  })
  @ApiOkResponse({ type: ScreenedResponseDto })
  screen(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: ScreeningDto) {
    const { version: donationVersion, ...results } = dto;
    return this.commandBus.execute(new ScreenDonationCommand(actor, params.id, donationVersion, results));
  }

  @Post('donations/:id/components')
  @RequirePermissions('bb:collect')
  @ApiOperation({ summary: 'Split the donation into units (in quarantine until it is screened clear)' })
  @ApiCreatedResponse({ type: PreparedResponseDto })
  prepare(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: ComponentsDto) {
    return this.commandBus.execute(new PrepareComponentsCommand(actor, params.id, dto.componentTypeIds));
  }

  @Get('units')
  @RequirePermissions('bb:read')
  @ApiOperation({ summary: 'The stock: units by state, group and component, soonest out of date first' })
  @ApiOkResponse({ type: UnitPageResponseDto })
  units(@CurrentUser() actor: Actor, @Query() query: UnitListQueryDto) {
    return this.queryBus.execute(new ListUnitsQuery(actor, query));
  }

  @Post('units/:id/discard')
  @RequirePermissions('bb:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async discard(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: DiscardDto) {
    await this.commandBus.execute(new DiscardUnitCommand(actor, params.id, dto.version, dto.reason));
  }

  @Get('requests')
  @RequirePermissions('bb:read')
  @ApiOkResponse({ type: RequestPageResponseDto })
  requests(@CurrentUser() actor: Actor, @Query() query: RequestListQueryDto) {
    return this.queryBus.execute(new ListRequestsQuery(actor, query));
  }

  @Get('requests/:id')
  @RequirePermissions('bb:read')
  @ApiOkResponse({ type: BloodRequestResponseDto })
  request(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetRequestQuery(actor, params.id));
  }

  @Post('requests')
  @RequirePermissions('bb:request')
  @ApiOperation({ summary: "Units of a component for a patient's stay, or on a diagnostic bill of theirs" })
  @ApiCreatedResponse({ type: NumberedResponseDto })
  raise(@CurrentUser() actor: Actor, @Body() dto: BloodRequestDto) {
    return this.commandBus.execute(new RequestBloodCommand(actor, dto));
  }

  @Post('requests/:id/crossmatch')
  @RequirePermissions('bb:issue')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Try a unit the patient may receive; a compatible one is kept for the request' })
  @ApiOkResponse({ type: CrossmatchedResponseDto })
  crossmatch(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: CrossmatchDto) {
    return this.commandBus.execute(new CrossmatchCommand(actor, params.id, dto.unitId, dto.result, dto.method));
  }

  @Post('requests/:id/issue')
  @RequirePermissions('bb:issue')
  @ApiOperation({ summary: "Give a unit kept for the request (charged to the stay, or paid on the patient's bill)" })
  @ApiCreatedResponse({ type: IssuedResponseDto })
  issue(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: IssueDto) {
    return this.commandBus.execute(new IssueBloodCommand(actor, params.id, dto.unitId));
  }

  @Post('requests/:id/cancel')
  @RequirePermissions('bb:request')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: CancelledResponseDto })
  cancel(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: RequestVersionDto) {
    return this.commandBus.execute(new CancelRequestCommand(actor, params.id, dto.version));
  }
}

export const BLOOD_CONTROLLERS = [ComponentTypesController, BloodBankController];
