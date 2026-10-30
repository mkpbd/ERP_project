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
  CreatePersonCommand,
  ListPeopleQuery,
  MARKETING_RECORDS,
  OfficerDoctorsQuery,
  PerformanceQuery,
  SetOfficerDoctorsCommand,
  SetTargetCommand,
  UpdatePersonCommand,
} from '../application/marketing.messages.js';
import { PERSON_KINDS } from '../domain/team.js';

const zoneFields = { name: z.string().trim().min(1).max(100), isActive: z.boolean() };
class MarketingCreateZoneDto extends createZodDto(
  z.strictObject({ ...zoneFields, isActive: z.boolean().default(true) }),
) {}
class MarketingUpdateZoneDto extends createZodDto(updateSchema(zoneFields)) {}
class MarketingZoneFilterDto extends createZodDto(
  z.object({ q: z.string().trim().min(1).max(100).optional(), isActive: z.enum(['true', 'false']).optional() }),
) {}
class MarketingZoneResponseDto extends responseDto(recordResponseShape(zoneFields)) {}

const areaFields = { zoneId: z.uuid(), name: z.string().trim().min(1).max(100), isActive: z.boolean() };
class MarketingCreateAreaDto extends createZodDto(
  z.strictObject({ ...areaFields, isActive: z.boolean().default(true) }),
) {}
class MarketingUpdateAreaDto extends createZodDto(updateSchema(areaFields)) {}
class MarketingAreaFilterDto extends createZodDto(
  z.object({
    q: z.string().trim().min(1).max(100).optional(),
    zoneId: z.uuid().optional(),
    isActive: z.enum(['true', 'false']).optional(),
  }),
) {}
class MarketingAreaResponseDto extends responseDto(recordResponseShape(areaFields)) {}

const access = { tag: 'marketing', readPermission: 'mkt:read', managePermission: 'mkt:manage' } as const;
/** Old Marketing.MarketingZone. */
export const MarketingZonesController = createRecordController({
  ...access,
  className: 'MarketingZonesController',
  path: 'marketing/zones',
  type: MARKETING_RECORDS.zone,
  label: 'marketing zone',
  create: MarketingCreateZoneDto,
  update: MarketingUpdateZoneDto,
  response: MarketingZoneResponseDto,
  filter: MarketingZoneFilterDto,
});
/** Old Marketing.MarketingArea. */
export const MarketingAreasController = createRecordController({
  ...access,
  className: 'MarketingAreasController',
  path: 'marketing/areas',
  type: MARKETING_RECORDS.area,
  label: 'marketing area',
  create: MarketingCreateAreaDto,
  update: MarketingUpdateAreaDto,
  response: MarketingAreaResponseDto,
  filter: MarketingAreaFilterDto,
});

const personFields = {
  name: z.string().max(150),
  code: z.string().max(20).nullable().default(null),
  phone: z.string().max(20).nullable().default(null),
  parentId: z.uuid().nullable().default(null),
  zoneId: z.uuid().nullable().default(null),
};
class MarketingPersonDto extends createZodDto(z.strictObject({ kind: z.enum(PERSON_KINDS), ...personFields })) {}
class MarketingPersonUpdateDto extends createZodDto(
  z.strictObject({ version: z.int().min(1), ...personFields, isActive: z.boolean() }),
) {}
class MarketingPeopleQueryDto extends createZodDto(z.object({ kind: z.enum(PERSON_KINDS).optional() })) {}
class MarketingDoctorsDto extends createZodDto(z.strictObject({ doctorIds: z.array(z.uuid()).max(500) })) {}
class MarketingTargetDto extends createZodDto(
  z.strictObject({
    officerId: z.uuid().nullable().default(null),
    year: z.int().min(2000).max(2100),
    month: z.int().min(1).max(12),
    amount: z.number().min(0).max(1_000_000_000).multipleOf(0.01).nullable(),
  }),
) {}
class MarketingMonthQueryDto extends createZodDto(
  z.object({ year: z.coerce.number().int().min(2000).max(2100), month: z.coerce.number().int().min(1).max(12) }),
) {}

class MarketingIdResponseDto extends responseDto({ id: z.uuid() }) {}
class MarketingVersionResponseDto extends responseDto({ version: z.int() }) {}
class MarketingPeopleResponseDto extends responseDto({
  items: z.array(
    z.object({
      id: z.uuid(),
      kind: z.enum(PERSON_KINDS),
      name: z.string(),
      code: z.string().nullable(),
      phone: z.string().nullable(),
      parentId: z.uuid().nullable(),
      parentName: z.string().nullable(),
      zoneId: z.uuid().nullable(),
      zoneName: z.string().nullable(),
      isActive: z.boolean(),
      version: z.int(),
    }),
  ),
}) {}
class MarketingDoctorListResponseDto extends responseDto({
  items: z.array(z.object({ id: z.uuid(), name: z.string() })),
}) {}
class MarketingPerformanceResponseDto extends responseDto({
  year: z.int(),
  month: z.int(),
  rows: z.array(
    z.object({
      officerId: z.uuid(),
      officerName: z.string(),
      managerName: z.string().nullable(),
      zoneName: z.string().nullable(),
      doctors: z.int(),
      opd: z.number(),
      diagnostic: z.number(),
      indoor: z.number(),
      achieved: z.number(),
      target: z.number().nullable(),
      percent: z.number().nullable(),
    }),
  ),
  total: z.number(),
  unassigned: z.number(),
  grossTarget: z.number().nullable(),
  grossPercent: z.number().nullable(),
}) {}

@ApiTags('marketing')
@ApiBearerAuth()
@Controller({ path: 'marketing', version: '1' })
export class MarketingController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('people')
  @RequirePermissions('mkt:read')
  @ApiOperation({ summary: 'The team: managers, officers (with their zones) and agents, with whom each works under' })
  @ApiOkResponse({ type: MarketingPeopleResponseDto })
  async people(@CurrentUser() actor: Actor, @Query() query: MarketingPeopleQueryDto) {
    return { items: await this.queryBus.execute(new ListPeopleQuery(actor, query.kind)) };
  }

  @Post('people')
  @RequirePermissions('mkt:manage')
  @ApiOperation({ summary: 'A manager (under nobody), an officer under a manager, an agent under an officer' })
  @ApiCreatedResponse({ type: MarketingIdResponseDto })
  create(@CurrentUser() actor: Actor, @Body() dto: MarketingPersonDto) {
    return this.commandBus.execute(new CreatePersonCommand(actor, dto));
  }

  @Put('people/:id')
  @RequirePermissions('mkt:manage')
  @ApiOkResponse({ type: MarketingVersionResponseDto })
  update(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: MarketingPersonUpdateDto) {
    const { version, ...input } = dto;
    return this.commandBus.execute(new UpdatePersonCommand(actor, params.id, version, input));
  }

  @Get('people/:id/doctors')
  @RequirePermissions('mkt:read')
  @ApiOkResponse({ type: MarketingDoctorListResponseDto })
  async doctors(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return { items: await this.queryBus.execute(new OfficerDoctorsQuery(actor, params.id)) };
  }

  @Put('people/:id/doctors')
  @RequirePermissions('mkt:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "The officer's referring doctors (the whole list); a doctor moves from any other officer" })
  @ApiNoContentResponse()
  async setDoctors(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: MarketingDoctorsDto) {
    await this.commandBus.execute(new SetOfficerDoctorsCommand(actor, params.id, dto.doctorIds));
  }

  @Put('targets')
  @RequirePermissions('mkt:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "A month's target of an officer, or the gross target (no officer); amount null removes it" })
  @ApiNoContentResponse()
  async target(@CurrentUser() actor: Actor, @Body() dto: MarketingTargetDto) {
    await this.commandBus.execute(new SetTargetCommand(actor, dto.officerId, dto.year, dto.month, dto.amount));
  }

  @Get('performance')
  @RequirePermissions('mkt:read')
  @ApiOperation({ summary: "Each officer's doctors' referred billing in the month against their target; the gross" })
  @ApiOkResponse({ type: MarketingPerformanceResponseDto })
  performance(@CurrentUser() actor: Actor, @Query() query: MarketingMonthQueryDto) {
    return this.queryBus.execute(new PerformanceQuery(actor, query.year, query.month));
  }
}

export const MARKETING_CONTROLLERS = [MarketingZonesController, MarketingAreasController, MarketingController];
