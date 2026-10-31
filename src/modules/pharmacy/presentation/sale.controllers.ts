import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor } from '../../../shared/application/actor.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import { IdParamDto } from '../../../shared/presentation/zod/common.schemas.js';
import {
  CancelSaleCommand,
  CollectCorporateDueCommand,
  CollectDueCommand,
  CollectStaffDueCommand,
  GetCorporateDuesQuery,
  GetDiscountPolicyQuery,
  GetMemberDuesQuery,
  GetStaffDuesQuery,
  GetSaleQuery,
  ListSalesQuery,
  MakeSaleCommand,
  QuoteSaleQuery,
  SetDiscountPolicyCommand,
} from '../application/sale.messages.js';
import {
  PharmacyCancelSaleDto,
  PharmacyCollectDto,
  PharmacyCollectedResponseDto,
  PharmacyCorporateDuesResponseDto,
  PharmacyDiscountPolicyDto,
  PharmacyDiscountPolicyResponseDto,
  PharmacyMemberDuesResponseDto,
  PharmacyQuoteDto,
  PharmacyQuoteResponseDto,
  PharmacySaleDto,
  PharmacySaleListQueryDto,
  PharmacySalePageResponseDto,
  PharmacySaleResponseDto,
  PharmacySoldResponseDto,
  PharmacyStaffDuesResponseDto,
} from './dto/sale.dto.js';

@ApiTags('pharmacy')
@ApiBearerAuth()
@Controller({ path: 'pharmacy', version: '1' })
export class PharmacySalesController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('discount-policy')
  @RequirePermissions('pharmacy:read')
  @ApiOkResponse({ type: PharmacyDiscountPolicyResponseDto })
  policy(@CurrentUser() actor: Actor) {
    return this.queryBus.execute(new GetDiscountPolicyQuery(actor));
  }

  @Put('discount-policy')
  @RequirePermissions('pharmacy:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'The pharmacy-wide default discount (products may have their own rule)' })
  async setPolicy(@CurrentUser() actor: Actor, @Body() dto: PharmacyDiscountPolicyDto) {
    await this.commandBus.execute(new SetDiscountPolicyCommand(actor, dto));
  }

  @Post('sales/quote')
  @RequirePermissions('pharmacy:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lots, rates, discounts and totals a sale would have, without making it' })
  @ApiOkResponse({ type: PharmacyQuoteResponseDto })
  quote(@CurrentUser() actor: Actor, @Body() dto: PharmacyQuoteDto) {
    return this.queryBus.execute(new QuoteSaleQuery(actor, dto.outletId, dto.on, dto.lines));
  }

  @Get('sales')
  @RequirePermissions('pharmacy:read')
  @ApiOkResponse({ type: PharmacySalePageResponseDto })
  list(@CurrentUser() actor: Actor, @Query() query: PharmacySaleListQueryDto) {
    return this.queryBus.execute(new ListSalesQuery(actor, query));
  }

  @Get('sales/:id')
  @RequirePermissions('pharmacy:read')
  @ApiOkResponse({ type: PharmacySaleResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetSaleQuery(actor, params.id));
  }

  @Post('sales')
  @RequirePermissions('pharmacy:sell')
  @ApiOperation({ summary: 'Sell over the counter at an outlet you work at' })
  @ApiCreatedResponse({ type: PharmacySoldResponseDto })
  sell(@CurrentUser() actor: Actor, @Body() dto: PharmacySaleDto) {
    return this.commandBus.execute(
      new MakeSaleCommand(
        actor,
        dto.outletId,
        dto.soldOn,
        dto.customerName,
        dto.mobileNo,
        dto.loyalMemberId,
        dto.corporateClientId,
        dto.staffId,
        dto.lines,
        dto.method,
        dto.reference,
        dto.tendered,
      ),
    );
  }

  @Post('sales/:id/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Undo a whole sale nothing was collected against (pharmacy:manage, or the seller the same day)',
  })
  async cancel(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: PharmacyCancelSaleDto) {
    await this.commandBus.execute(new CancelSaleCommand(actor, params.id, dto.version, dto.on, dto.reason));
  }

  @Get('loyal-members/:id/dues')
  @RequirePermissions('pharmacy:read')
  @ApiOkResponse({ type: PharmacyMemberDuesResponseDto })
  dues(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetMemberDuesQuery(actor, params.id));
  }

  @Post('loyal-members/:id/collections')
  @RequirePermissions('pharmacy:sell')
  @ApiOperation({ summary: "Collect a payment against a loyal member's dues, oldest sale first" })
  @ApiCreatedResponse({ type: PharmacyCollectedResponseDto })
  collect(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: PharmacyCollectDto) {
    return this.commandBus.execute(
      new CollectDueCommand(actor, params.id, dto.collectedOn, dto.amount, dto.method, dto.reference),
    );
  }

  @Get('corporate-clients/:id/dues')
  @RequirePermissions('pharmacy:read')
  @ApiOperation({ summary: "A company's pharmacy credit sales still owing, and all it owes against its limit" })
  @ApiOkResponse({ type: PharmacyCorporateDuesResponseDto })
  corporateDues(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetCorporateDuesQuery(actor, params.id));
  }

  @Post('corporate-clients/:id/collections')
  @RequirePermissions('pharmacy:sell')
  @ApiOperation({ summary: "Collect a company's payment against its pharmacy credit sales, oldest first" })
  @ApiCreatedResponse({ type: PharmacyCollectedResponseDto })
  collectCorporate(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: PharmacyCollectDto) {
    return this.commandBus.execute(
      new CollectCorporateDueCommand(actor, params.id, dto.collectedOn, dto.amount, dto.method, dto.reference),
    );
  }

  @Get('staff/:id/dues')
  @RequirePermissions('pharmacy:read')
  @ApiOperation({ summary: "A staff member's staff ledger balance and latest pharmacy credit sales" })
  @ApiOkResponse({ type: PharmacyStaffDuesResponseDto })
  staffDues(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetStaffDuesQuery(actor, params.id));
  }

  @Post('staff/:id/collections')
  @RequirePermissions('pharmacy:sell')
  @ApiOperation({ summary: 'Collect what a staff member pays against their staff ledger' })
  @ApiCreatedResponse({ type: PharmacyCollectedResponseDto })
  collectStaff(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: PharmacyCollectDto) {
    return this.commandBus.execute(
      new CollectStaffDueCommand(actor, params.id, dto.collectedOn, dto.amount, dto.method, dto.reference),
    );
  }
}

export const SALE_CONTROLLERS = [PharmacySalesController];
