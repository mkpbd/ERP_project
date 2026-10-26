import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor } from '../../../shared/application/actor.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import { IdParamDto } from '../../../shared/presentation/zod/common.schemas.js';
import {
  CreateOrderCommand,
  CreateReceiveCommand,
  DeleteReceiveCommand,
  EditOrderCommand,
  EditReceiveCommand,
  EndOrderCommand,
  EnterOpeningStockCommand,
  GetOrderQuery,
  GetReceiveQuery,
  GetStockCardQuery,
  GetStockQuery,
  ListOrdersQuery,
  ListReceivesQuery,
  PostReceiveCommand,
} from '../application/purchase.messages.js';
import {
  PharmacyCreatedDocumentResponseDto,
  PharmacyCreateOrderDto,
  PharmacyCreateReceiveDto,
  PharmacyDocumentListQueryDto,
  PharmacyEditOrderDto,
  PharmacyEditReceiveDto,
  PharmacyEndOrderDto,
  PharmacyOpeningStockDto,
  PharmacyOrderPageResponseDto,
  PharmacyOrderResponseDto,
  PharmacyPostedResponseDto,
  PharmacyReceivePageResponseDto,
  PharmacyReceiveResponseDto,
  PharmacyStockCardQueryDto,
  PharmacyStockCardResponseDto,
  PharmacyStockQueryDto,
  PharmacyStockResponseDto,
  PharmacyVersionDto,
  PharmacyVersionQueryDto,
} from './dto/purchase.dto.js';

@ApiTags('pharmacy')
@ApiBearerAuth()
@Controller({ path: 'pharmacy/purchase-orders', version: '1' })
export class PharmacyOrdersController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @RequirePermissions('pharmacy:read')
  @ApiOkResponse({ type: PharmacyOrderPageResponseDto })
  list(@CurrentUser() actor: Actor, @Query() query: PharmacyDocumentListQueryDto) {
    return this.queryBus.execute(new ListOrdersQuery(actor, query));
  }

  @Get(':id')
  @RequirePermissions('pharmacy:read')
  @ApiOkResponse({ type: PharmacyOrderResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetOrderQuery(actor, params.id));
  }

  @Post()
  @RequirePermissions('pharmacy:purchase')
  @ApiOperation({ summary: 'Order products from a supplier for an outlet' })
  @ApiCreatedResponse({ type: PharmacyCreatedDocumentResponseDto })
  create(@CurrentUser() actor: Actor, @Body() dto: PharmacyCreateOrderDto) {
    const { lines, ...header } = dto;
    return this.commandBus.execute(new CreateOrderCommand(actor, header, lines));
  }

  @Patch(':id')
  @RequirePermissions('pharmacy:purchase')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Edit an order nothing has been received against' })
  async edit(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: PharmacyEditOrderDto) {
    const { version, lines, ...header } = dto;
    await this.commandBus.execute(new EditOrderCommand(actor, params.id, version, header, lines));
  }

  @Post(':id/cancel')
  @RequirePermissions('pharmacy:purchase')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel an order nothing has been received against' })
  async cancel(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: PharmacyEndOrderDto) {
    await this.commandBus.execute(new EndOrderCommand(actor, params.id, dto.version, 'cancel', dto.reason));
  }

  @Post(':id/close')
  @RequirePermissions('pharmacy:purchase')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Close a partly received order with what came' })
  async close(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: PharmacyEndOrderDto) {
    await this.commandBus.execute(new EndOrderCommand(actor, params.id, dto.version, 'close', dto.reason));
  }
}

@ApiTags('pharmacy')
@ApiBearerAuth()
@Controller({ path: 'pharmacy/receives', version: '1' })
export class PharmacyReceivesController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @RequirePermissions('pharmacy:read')
  @ApiOkResponse({ type: PharmacyReceivePageResponseDto })
  list(@CurrentUser() actor: Actor, @Query() query: PharmacyDocumentListQueryDto) {
    return this.queryBus.execute(new ListReceivesQuery(actor, query));
  }

  @Get(':id')
  @RequirePermissions('pharmacy:read')
  @ApiOkResponse({ type: PharmacyReceiveResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetReceiveQuery(actor, params.id));
  }

  @Post()
  @RequirePermissions('pharmacy:receive')
  @ApiOperation({ summary: 'Draft a receive of medicines into an outlet you work at' })
  @ApiCreatedResponse({ type: PharmacyCreatedDocumentResponseDto })
  create(@CurrentUser() actor: Actor, @Body() dto: PharmacyCreateReceiveDto) {
    const { lines, ...header } = dto;
    return this.commandBus.execute(new CreateReceiveCommand(actor, header, lines));
  }

  @Patch(':id')
  @RequirePermissions('pharmacy:receive')
  @HttpCode(HttpStatus.NO_CONTENT)
  async edit(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: PharmacyEditReceiveDto) {
    const { version, lines, ...header } = dto;
    await this.commandBus.execute(new EditReceiveCommand(actor, params.id, version, header, lines));
  }

  @Post(':id/post')
  @RequirePermissions('pharmacy:receive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Put the medicines in stock by lot and post the purchase to accounts' })
  @ApiOkResponse({ type: PharmacyPostedResponseDto })
  post(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: PharmacyVersionDto) {
    return this.commandBus.execute(new PostReceiveCommand(actor, params.id, dto.version));
  }

  @Delete(':id')
  @RequirePermissions('pharmacy:receive')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Query() query: PharmacyVersionQueryDto) {
    await this.commandBus.execute(new DeleteReceiveCommand(actor, params.id, query.version));
  }
}

@ApiTags('pharmacy')
@ApiBearerAuth()
@Controller({ path: 'pharmacy', version: '1' })
export class PharmacyStockController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post('opening-stock')
  @RequirePermissions('pharmacy:manage')
  @ApiOperation({ summary: "Enter an outlet's opening stock by lot" })
  @ApiCreatedResponse({ type: PharmacyCreatedDocumentResponseDto })
  opening(@CurrentUser() actor: Actor, @Body() dto: PharmacyOpeningStockDto) {
    return this.commandBus.execute(
      new EnterOpeningStockCommand(actor, dto.outletId, dto.openedOn, dto.note, dto.lines),
    );
  }

  @Get('stock')
  @RequirePermissions('pharmacy:read')
  @ApiOperation({ summary: "An outlet's stock by product and lot, at cost and sale rate, with reorder flags" })
  @ApiOkResponse({ type: PharmacyStockResponseDto })
  async stock(@CurrentUser() actor: Actor, @Query() query: PharmacyStockQueryDto) {
    const { belowReorderOnly, ...filter } = query;
    return {
      items: await this.queryBus.execute(
        new GetStockQuery(actor, { ...filter, belowReorderOnly: belowReorderOnly === 'true' }),
      ),
    };
  }

  @Get('stock/card')
  @RequirePermissions('pharmacy:read')
  @ApiOperation({ summary: "One product's movements at an outlet over a period, with the running balance" })
  @ApiOkResponse({ type: PharmacyStockCardResponseDto })
  card(@CurrentUser() actor: Actor, @Query() query: PharmacyStockCardQueryDto) {
    return this.queryBus.execute(new GetStockCardQuery(actor, query.outletId, query.productId, query.from, query.to));
  }
}

export const PURCHASE_CONTROLLERS = [PharmacyOrdersController, PharmacyReceivesController, PharmacyStockController];
