import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
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
  AddCountLotCommand,
  ApplyCountCommand,
  CancelCountCommand,
  GetCountQuery,
  ListCountsQuery,
  OpenCountCommand,
  RecordCountsCommand,
} from '../application/count.messages.js';

const day = z.iso.date();
const ref = z.uuid();
const version = z.int().min(1);

class PharmacyOpenCountDto extends createZodDto(
  z.strictObject({
    outletId: ref,
    countDate: day,
    note: z.string().trim().max(1000).nullable().default(null),
    productIds: z.array(ref).min(1).max(5000).nullable().default(null),
  }),
) {}
class PharmacyRecordCountsDto extends createZodDto(
  z.strictObject({
    version,
    counts: z
      .array(
        z.strictObject({
          lotId: ref,
          qty: z.int().min(0).max(10_000_000),
          note: z.string().trim().max(300).nullable().optional(),
          writeOff: z.boolean().optional(),
        }),
      )
      .min(1)
      .max(5000),
  }),
) {}
class PharmacyAddCountLotDto extends createZodDto(
  z.strictObject({
    version,
    productId: ref,
    batchNo: z.string().trim().max(50).nullable().default(null),
    expiryDate: day,
    saleRate: z.number().min(0).max(1_000_000_000),
    unitCost: z.number().min(0).max(1_000_000_000).nullable().default(null),
    countedQty: z.int().min(0).max(10_000_000),
  }),
) {}
class PharmacyCountVersionDto extends createZodDto(z.strictObject({ version })) {}
class PharmacyCancelCountDto extends createZodDto(
  z.strictObject({ version, reason: z.string().trim().min(1).max(500) }),
) {}
class PharmacyCountListQueryDto extends createZodDto(
  z.object({ ...paginationShape, outletId: ref.optional(), status: z.string().trim().max(30).optional() }),
) {}
class PharmacyOpenedCountResponseDto extends responseDto({ id: z.uuid(), number: z.string(), lines: z.int() }) {}
class PharmacyAppliedCountResponseDto extends responseDto({
  shortage: z.number(),
  writtenOff: z.number(),
  excess: z.number(),
  voucherNumber: z.string().nullable(),
}) {}
const summaryShape = {
  id: z.uuid(),
  number: z.string(),
  countDate: z.string(),
  outletId: z.uuid(),
  outletName: z.string(),
  status: z.string(),
  lineCount: z.int(),
  countedLines: z.int(),
  shortageValue: z.number(),
  excessValue: z.number(),
  writtenOffValue: z.number(),
  version: z.int(),
};
class PharmacyCountPageResponseDto extends responseDto({
  items: z.array(z.object(summaryShape)),
  ...pageMetaShape,
}) {}
class PharmacyCountResponseDto extends responseDto({
  ...summaryShape,
  note: z.string().nullable(),
  voucherNumber: z.string().nullable(),
  cancelReason: z.string().nullable(),
  createdBy: z.uuid().nullable(),
  appliedBy: z.uuid().nullable(),
  appliedAt: z.date().nullable(),
  lines: z.array(
    z.object({
      productId: z.uuid(),
      displayName: z.string(),
      genericName: z.string(),
      unitName: z.string().nullable(),
      line: z.int(),
      lotId: z.uuid(),
      batchNo: z.string().nullable(),
      expiryDate: z.string(),
      expired: z.boolean(),
      systemQty: z.int(),
      countedQty: z.int().nullable(),
      unitCost: z.number(),
      note: z.string().nullable(),
      writeOff: z.boolean(),
      appliedSystemQty: z.int().nullable(),
      adjustedQty: z.int().nullable(),
      adjustedValue: z.number().nullable(),
    }),
  ),
}) {}

@ApiTags('pharmacy')
@ApiBearerAuth()
@Controller({ path: 'pharmacy/stock-counts', version: '1' })
export class PharmacyCountsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @RequirePermissions('pharmacy:read')
  @ApiOkResponse({ type: PharmacyCountPageResponseDto })
  list(@CurrentUser() actor: Actor, @Query() query: PharmacyCountListQueryDto) {
    return this.queryBus.execute(new ListCountsQuery(actor, query));
  }

  @Get(':id')
  @RequirePermissions('pharmacy:read')
  @ApiOkResponse({ type: PharmacyCountResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetCountQuery(actor, params.id));
  }

  @Post()
  @RequirePermissions('pharmacy:count')
  @ApiOperation({ summary: "Open a count of an outlet's lots as of a date (all products, or some)" })
  @ApiCreatedResponse({ type: PharmacyOpenedCountResponseDto })
  open(@CurrentUser() actor: Actor, @Body() dto: PharmacyOpenCountDto) {
    return this.commandBus.execute(new OpenCountCommand(actor, dto.outletId, dto.countDate, dto.note, dto.productIds));
  }

  @Post(':id/counts')
  @RequirePermissions('pharmacy:count')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Record (or correct) what was counted, lot by lot' })
  async record(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: PharmacyRecordCountsDto) {
    await this.commandBus.execute(new RecordCountsCommand(actor, params.id, dto.version, dto.counts));
  }

  @Post(':id/lots')
  @RequirePermissions('pharmacy:count')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Add a lot found on the shelf that the count does not list' })
  async addLot(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: PharmacyAddCountLotDto) {
    const { version: countVersion, ...lot } = dto;
    await this.commandBus.execute(new AddCountLotCommand(actor, params.id, countVersion, lot));
  }

  @Post(':id/apply')
  @RequirePermissions('pharmacy:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Move every lot to its count (as of the count date) and post the deviations' })
  @ApiOkResponse({ type: PharmacyAppliedCountResponseDto })
  apply(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: PharmacyCountVersionDto) {
    return this.commandBus.execute(new ApplyCountCommand(actor, params.id, dto.version));
  }

  @Post(':id/cancel')
  @RequirePermissions('pharmacy:count')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cancel(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: PharmacyCancelCountDto) {
    await this.commandBus.execute(new CancelCountCommand(actor, params.id, dto.version, dto.reason));
  }
}

export const COUNT_CONTROLLERS = [PharmacyCountsController];
