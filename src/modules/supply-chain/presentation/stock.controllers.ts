import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page } from '../../../shared/application/pagination.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import { createRecordController } from '../../../shared/presentation/record-controller.js';
import { IdParamDto } from '../../../shared/presentation/zod/common.schemas.js';
import {
  CloseOrderCommand,
  CreateReceiveCommand,
  DeleteReceiveCommand,
  EditReceiveCommand,
  EnterOpeningStockCommand,
  GetReceiveQuery,
  GetStockCardQuery,
  GetStockQuery,
  ListReceivesQuery,
  PostReceiveCommand,
  type ReceiveSummary,
  type ReceiveView,
  type StockCard,
  type StockRow,
} from '../application/stock.messages.js';
import { GRN_FAULT } from '../application/supply-chain.constants.js';
import type { StoreRef } from '../domain/repositories.js';
import { CreatedDocumentResponseDto, DocumentListQueryDto, VersionDto, VersionQueryDto } from './dto/purchase.dto.js';
import {
  CloseOrderDto,
  CreateGrnFaultDto,
  CreateReceiveDto,
  EditReceiveDto,
  GrnFaultFilterDto,
  GrnFaultResponseDto,
  OpeningStockDto,
  PostedReceiveResponseDto,
  ReceivePageResponseDto,
  ReceiveResponseDto,
  StockCardQueryDto,
  StockCardResponseDto,
  StockQueryDto,
  StockResponseDto,
  UpdateGrnFaultDto,
} from './dto/stock.dto.js';

const storeOf = (query: { mainStoreId?: string | undefined; subStoreId?: string | undefined }): StoreRef =>
  query.mainStoreId ? { mainStoreId: query.mainStoreId } : { subStoreId: query.subStoreId! };

@ApiTags('supply-chain')
@ApiBearerAuth()
@Controller({ path: 'scm/stock-receives', version: '1' })
export class StockReceivesController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @RequirePermissions('scm:read')
  @ApiOkResponse({ type: ReceivePageResponseDto })
  list(@CurrentUser() actor: Actor, @Query() query: DocumentListQueryDto): Promise<Page<ReceiveSummary>> {
    return this.queryBus.execute(new ListReceivesQuery(actor, query));
  }

  @Post()
  @RequirePermissions('scm:receive')
  @ApiOperation({ summary: 'Draft a stock receive, against a purchase order or without one' })
  @ApiCreatedResponse({ type: CreatedDocumentResponseDto })
  create(@CurrentUser() actor: Actor, @Body() dto: CreateReceiveDto) {
    const { lines, ...header } = dto;
    return this.commandBus.execute(new CreateReceiveCommand(actor, header, lines));
  }

  @Get(':id')
  @RequirePermissions('scm:read')
  @ApiOkResponse({ type: ReceiveResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto): Promise<ReceiveView> {
    return this.queryBus.execute(new GetReceiveQuery(actor, params.id));
  }

  @Patch(':id')
  @RequirePermissions('scm:receive')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Edit a draft receive' })
  async edit(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: EditReceiveDto) {
    const { version, lines, ...header } = dto;
    await this.commandBus.execute(new EditReceiveCommand(actor, params.id, version, header, lines));
  }

  @Post(':id/post')
  @RequirePermissions('scm:receive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Put the goods in stock, add them to the order and post the purchase to accounts' })
  @ApiOkResponse({ type: PostedReceiveResponseDto })
  post(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: VersionDto) {
    return this.commandBus.execute(new PostReceiveCommand(actor, params.id, dto.version));
  }

  @Delete(':id')
  @RequirePermissions('scm:receive')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a draft receive' })
  async remove(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Query() query: VersionQueryDto) {
    await this.commandBus.execute(new DeleteReceiveCommand(actor, params.id, query.version));
  }
}

@ApiTags('supply-chain')
@ApiBearerAuth()
@Controller({ path: 'scm', version: '1' })
export class StockController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('stock')
  @RequirePermissions('scm:read')
  @ApiOperation({ summary: "A store's stock by item and lot, with value and reorder flags" })
  @ApiOkResponse({ type: StockResponseDto })
  async stock(@CurrentUser() actor: Actor, @Query() query: StockQueryDto): Promise<{ items: StockRow[] }> {
    const { mainStoreId: _main, subStoreId: _sub, ...filter } = query;
    return { items: await this.queryBus.execute(new GetStockQuery(actor, { ...filter, store: storeOf(query) })) };
  }

  @Get('stock/card')
  @RequirePermissions('scm:read')
  @ApiOperation({ summary: "One item's movements in a store, with running balance (stock card)" })
  @ApiOkResponse({ type: StockCardResponseDto })
  card(@CurrentUser() actor: Actor, @Query() query: StockCardQueryDto): Promise<StockCard> {
    return this.queryBus.execute(new GetStockCardQuery(actor, storeOf(query), query.variantId, query.from, query.to));
  }

  @Post('opening-stock')
  @RequirePermissions('scm:manage')
  @ApiOperation({ summary: 'Enter opening stock for a store' })
  @ApiCreatedResponse({ type: CreatedDocumentResponseDto })
  opening(@CurrentUser() actor: Actor, @Body() dto: OpeningStockDto) {
    return this.commandBus.execute(
      new EnterOpeningStockCommand(actor, storeOf(dto), dto.openedOn, dto.note, dto.lines),
    );
  }

  @Post('purchase-orders/:id/close')
  @RequirePermissions('scm:purchase')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Stop waiting for the rest of a partly received order' })
  async close(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: CloseOrderDto) {
    await this.commandBus.execute(new CloseOrderCommand(actor, params.id, dto.version, dto.reason));
  }
}

export const GrnFaultsController = createRecordController({
  tag: 'supply-chain',
  readPermission: 'scm:read',
  managePermission: 'scm:receive',
  className: 'GrnFaultsController',
  path: 'scm/grn-faults',
  type: GRN_FAULT,
  label: 'GRN fault',
  create: CreateGrnFaultDto,
  update: UpdateGrnFaultDto,
  response: GrnFaultResponseDto,
  filter: GrnFaultFilterDto,
});

export const STOCK_CONTROLLERS = [StockReceivesController, StockController, GrnFaultsController];
