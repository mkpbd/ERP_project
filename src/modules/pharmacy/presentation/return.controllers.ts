import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
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
  GetReturnPoliciesQuery,
  GetSaleReturnQuery,
  ListSaleReturnsQuery,
  ReturnSaleCommand,
  SetReturnPolicyCommand,
} from '../application/return.messages.js';

const day = z.iso.date();
const ref = z.uuid();
const policyShape = z.object({ isEnabled: z.boolean(), days: z.int() }).nullable();

class PharmacyReturnPolicyDto extends createZodDto(
  z.strictObject({ isEnabled: z.boolean(), days: z.int().min(0).max(365) }),
) {}
class PharmacyChannelParamDto extends createZodDto(z.object({ channel: z.enum(['opd', 'ipd']) })) {}
class PharmacyReturnPoliciesResponseDto extends responseDto({ opd: policyShape, ipd: policyShape }) {}
class PharmacyReturnSaleDto extends createZodDto(
  z.strictObject({
    version: z.int().min(1),
    returnedOn: day,
    reason: z.string().trim().max(500).nullable().default(null),
    lines: z
      .array(z.strictObject({ line: z.int().min(1).max(300), qty: z.int().min(1).max(10_000_000) }))
      .min(1)
      .max(300),
  }),
) {}
class PharmacyReturnedResponseDto extends responseDto({
  id: z.uuid(),
  number: z.string(),
  refund: z.number(),
  dueReduced: z.number(),
  cashRefund: z.number(),
  voucherNumber: z.string().nullable(),
}) {}
class PharmacyReturnListQueryDto extends createZodDto(
  z.object({
    ...paginationShape,
    saleId: ref.optional(),
    outletId: ref.optional(),
    from: day.optional(),
    to: day.optional(),
  }),
) {}
const returnShape = {
  id: z.uuid(),
  number: z.string(),
  returnedOn: z.string(),
  saleId: z.uuid(),
  saleNumber: z.string(),
  outletName: z.string(),
  refund: z.number(),
  dueReduced: z.number(),
  cashRefund: z.number(),
};
class PharmacySaleReturnPageResponseDto extends responseDto({
  items: z.array(z.object(returnShape)),
  ...pageMetaShape,
}) {}
class PharmacySaleReturnResponseDto extends responseDto({
  ...returnShape,
  soldOn: z.string(),
  customerName: z.string().nullable(),
  loyalMemberName: z.string().nullable(),
  reason: z.string().nullable(),
  amount: z.number(),
  discount: z.number(),
  voucherNumber: z.string().nullable(),
  lines: z.array(
    z.object({
      productId: z.uuid(),
      displayName: z.string(),
      genericName: z.string(),
      unitName: z.string().nullable(),
      saleLine: z.int(),
      batchNo: z.string().nullable(),
      expiryDate: z.string(),
      qty: z.int(),
      saleRate: z.number(),
      amount: z.number(),
      discount: z.number(),
      refund: z.number(),
    }),
  ),
}) {}

@ApiTags('pharmacy')
@ApiBearerAuth()
@Controller({ path: 'pharmacy', version: '1' })
export class PharmacyReturnsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('return-policies')
  @RequirePermissions('pharmacy:read')
  @ApiOkResponse({ type: PharmacyReturnPoliciesResponseDto })
  policies(@CurrentUser() actor: Actor) {
    return this.queryBus.execute(new GetReturnPoliciesQuery(actor));
  }

  @Put('return-policies/:channel')
  @RequirePermissions('pharmacy:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'How many days after a sale medicines may come back (over the counter or indoor)' })
  async setPolicy(
    @CurrentUser() actor: Actor,
    @Param() params: PharmacyChannelParamDto,
    @Body() dto: PharmacyReturnPolicyDto,
  ) {
    await this.commandBus.execute(new SetReturnPolicyCommand(actor, params.channel, dto));
  }

  @Post('sales/:id/returns')
  @RequirePermissions('pharmacy:sell')
  @ApiOperation({ summary: 'Medicines a customer brings back from a sale, within the return period' })
  @ApiCreatedResponse({ type: PharmacyReturnedResponseDto })
  giveBack(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: PharmacyReturnSaleDto) {
    return this.commandBus.execute(
      new ReturnSaleCommand(actor, params.id, dto.version, dto.returnedOn, dto.reason, dto.lines),
    );
  }

  @Get('sale-returns')
  @RequirePermissions('pharmacy:read')
  @ApiOkResponse({ type: PharmacySaleReturnPageResponseDto })
  list(@CurrentUser() actor: Actor, @Query() query: PharmacyReturnListQueryDto) {
    return this.queryBus.execute(new ListSaleReturnsQuery(actor, query));
  }

  @Get('sale-returns/:id')
  @RequirePermissions('pharmacy:read')
  @ApiOkResponse({ type: PharmacySaleReturnResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetSaleReturnQuery(actor, params.id));
  }
}

export const RETURN_CONTROLLERS = [PharmacyReturnsController];
