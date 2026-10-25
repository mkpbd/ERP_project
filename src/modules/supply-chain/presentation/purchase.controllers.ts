import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page } from '../../../shared/application/pagination.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import { IdParamDto } from '../../../shared/presentation/zod/common.schemas.js';
import {
  ActOnRequisitionCommand,
  ActOnStudyCommand,
  CancelOrderCommand,
  CreateOrderCommand,
  CreateRequisitionCommand,
  CreateStudyCommand,
  DecideRequisitionCommand,
  DecideStudyCommand,
  EditOrderCommand,
  EditRequisitionCommand,
  EditStudyCommand,
  GetOrderQuery,
  GetRequisitionQuery,
  GetStudyQuery,
  ListOrdersQuery,
  ListRequisitionsQuery,
  ListStudiesQuery,
  RequisitionInboxQuery,
  StudyInboxQuery,
  type OrderSummary,
  type OrderView,
  type RequisitionSummary,
  type RequisitionView,
  type StudySummary,
  type StudyView,
} from '../application/purchase.messages.js';
import {
  CancelOrderDto,
  CreatedDocumentResponseDto,
  CreateOrderDto,
  CreateRequisitionDto,
  CreateStudyDto,
  DecideRequisitionDto,
  DecideStudyDto,
  DecisionResultResponseDto,
  DocumentListQueryDto,
  EditOrderDto,
  EditRequisitionDto,
  EditStudyDto,
  OrderPageResponseDto,
  OrderResponseDto,
  RequisitionInboxResponseDto,
  RequisitionPageResponseDto,
  RequisitionResponseDto,
  StudyInboxResponseDto,
  StudyPageResponseDto,
  StudyResponseDto,
  VersionDto,
  VersionQueryDto,
} from './dto/purchase.dto.js';

@ApiTags('supply-chain')
@ApiBearerAuth()
@Controller({ path: 'scm/purchase-requisitions', version: '1' })
export class PurchaseRequisitionsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @RequirePermissions('scm:read')
  @ApiOkResponse({ type: RequisitionPageResponseDto })
  list(@CurrentUser() actor: Actor, @Query() query: DocumentListQueryDto): Promise<Page<RequisitionSummary>> {
    return this.queryBus.execute(new ListRequisitionsQuery(actor, query));
  }

  @Get('inbox')
  @ApiOperation({ summary: 'Pending requisitions waiting for one of your roles' })
  @ApiOkResponse({ type: RequisitionInboxResponseDto })
  async inbox(@CurrentUser() actor: Actor): Promise<{ items: RequisitionSummary[] }> {
    return { items: await this.queryBus.execute(new RequisitionInboxQuery(actor)) };
  }

  @Post()
  @RequirePermissions('scm:purchase')
  @ApiOperation({ summary: 'Draft a purchase requisition' })
  @ApiCreatedResponse({ type: CreatedDocumentResponseDto })
  create(@CurrentUser() actor: Actor, @Body() dto: CreateRequisitionDto) {
    const { lines, ...header } = dto;
    return this.commandBus.execute(new CreateRequisitionCommand(actor, header, lines));
  }

  @Get(':id')
  @RequirePermissions('scm:read')
  @ApiOkResponse({ type: RequisitionResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto): Promise<RequisitionView> {
    return this.queryBus.execute(new GetRequisitionQuery(actor, params.id));
  }

  @Patch(':id')
  @RequirePermissions('scm:purchase')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Edit a draft requisition' })
  async edit(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: EditRequisitionDto) {
    const { version, lines, ...header } = dto;
    await this.commandBus.execute(new EditRequisitionCommand(actor, params.id, version, header, lines));
  }

  @Post(':id/submit')
  @RequirePermissions('scm:purchase')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Send a draft to the main store's first approval level" })
  async submit(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: VersionDto) {
    await this.commandBus.execute(new ActOnRequisitionCommand(actor, params.id, dto.version, 'submit'));
  }

  @Post(':id/decision')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve (optionally lowering quantities) or reject at the current level' })
  @ApiOkResponse({ type: DecisionResultResponseDto })
  decide(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: DecideRequisitionDto) {
    return this.commandBus.execute(
      new DecideRequisitionCommand(
        actor,
        params.id,
        dto.version,
        dto.decision,
        dto.remarks,
        new Map(dto.quantities.map((line) => [line.variantId, line.approvedQty])),
      ),
    );
  }

  @Post(':id/cancel')
  @RequirePermissions('scm:purchase')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel a requisition no order uses' })
  async cancel(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: VersionDto) {
    await this.commandBus.execute(new ActOnRequisitionCommand(actor, params.id, dto.version, 'cancel'));
  }

  @Delete(':id')
  @RequirePermissions('scm:purchase')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a draft requisition' })
  async remove(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Query() query: VersionQueryDto) {
    await this.commandBus.execute(new ActOnRequisitionCommand(actor, params.id, query.version, 'delete'));
  }
}

@ApiTags('supply-chain')
@ApiBearerAuth()
@Controller({ path: 'scm/comparative-studies', version: '1' })
export class ComparativeStudiesController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @RequirePermissions('scm:read')
  @ApiOkResponse({ type: StudyPageResponseDto })
  list(@CurrentUser() actor: Actor, @Query() query: DocumentListQueryDto): Promise<Page<StudySummary>> {
    return this.queryBus.execute(new ListStudiesQuery(actor, query));
  }

  @Get('inbox')
  @ApiOperation({ summary: 'Pending studies waiting for you' })
  @ApiOkResponse({ type: StudyInboxResponseDto })
  async inbox(@CurrentUser() actor: Actor): Promise<{ items: StudySummary[] }> {
    return { items: await this.queryBus.execute(new StudyInboxQuery(actor)) };
  }

  @Post()
  @RequirePermissions('scm:purchase')
  @ApiOperation({ summary: "Draft a comparative study with the suppliers' quotes" })
  @ApiCreatedResponse({ type: CreatedDocumentResponseDto })
  create(@CurrentUser() actor: Actor, @Body() dto: CreateStudyDto) {
    const { quotes, ...header } = dto;
    return this.commandBus.execute(new CreateStudyCommand(actor, header, quotes));
  }

  @Get(':id')
  @RequirePermissions('scm:read')
  @ApiOkResponse({ type: StudyResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto): Promise<StudyView> {
    return this.queryBus.execute(new GetStudyQuery(actor, params.id));
  }

  @Patch(':id')
  @RequirePermissions('scm:purchase')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Edit a draft study' })
  async edit(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: EditStudyDto) {
    const { version, quotes, ...header } = dto;
    await this.commandBus.execute(new EditStudyCommand(actor, params.id, version, header, quotes));
  }

  @Post(':id/submit')
  @RequirePermissions('scm:purchase')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Send a draft to the first approval level' })
  async submit(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: VersionDto) {
    await this.commandBus.execute(new ActOnStudyCommand(actor, params.id, dto.version, 'submit'));
  }

  @Post(':id/decision')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve keeping some quotes in the running, or reject, at the current level' })
  @ApiOkResponse({ type: DecisionResultResponseDto })
  decide(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: DecideStudyDto) {
    return this.commandBus.execute(
      new DecideStudyCommand(actor, params.id, dto.version, dto.decision, dto.remarks, dto.keep),
    );
  }

  @Delete(':id')
  @RequirePermissions('scm:purchase')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a draft study' })
  async remove(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Query() query: VersionQueryDto) {
    await this.commandBus.execute(new ActOnStudyCommand(actor, params.id, query.version, 'delete'));
  }
}

@ApiTags('supply-chain')
@ApiBearerAuth()
@Controller({ path: 'scm/purchase-orders', version: '1' })
export class PurchaseOrdersController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @RequirePermissions('scm:read')
  @ApiOkResponse({ type: OrderPageResponseDto })
  list(@CurrentUser() actor: Actor, @Query() query: DocumentListQueryDto): Promise<Page<OrderSummary>> {
    return this.queryBus.execute(new ListOrdersQuery(actor, query));
  }

  @Post()
  @RequirePermissions('scm:purchase')
  @ApiOperation({ summary: 'Open a purchase order, within an approved requisition when one is given' })
  @ApiCreatedResponse({ type: CreatedDocumentResponseDto })
  create(@CurrentUser() actor: Actor, @Body() dto: CreateOrderDto) {
    const { lines, ...header } = dto;
    return this.commandBus.execute(new CreateOrderCommand(actor, header, lines));
  }

  @Get(':id')
  @RequirePermissions('scm:read')
  @ApiOkResponse({ type: OrderResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto): Promise<OrderView> {
    return this.queryBus.execute(new GetOrderQuery(actor, params.id));
  }

  @Patch(':id')
  @RequirePermissions('scm:purchase')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Edit an order nothing was received on' })
  async edit(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: EditOrderDto) {
    const { version, lines, ...header } = dto;
    await this.commandBus.execute(new EditOrderCommand(actor, params.id, version, header, lines));
  }

  @Post(':id/cancel')
  @RequirePermissions('scm:purchase')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel an order nothing was received on' })
  async cancel(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: CancelOrderDto) {
    await this.commandBus.execute(new CancelOrderCommand(actor, params.id, dto.version, dto.reason));
  }
}

export const PURCHASE_CONTROLLERS = [
  PurchaseRequisitionsController,
  ComparativeStudiesController,
  PurchaseOrdersController,
];
