import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page } from '../../../shared/application/pagination.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import { IdParamDto } from '../../../shared/presentation/zod/common.schemas.js';
import {
  ActOnIndentCommand,
  CloseRequestCommand,
  CreateIndentCommand,
  CreateIssueCommand,
  CreateRequestCommand,
  CreateTransferCommand,
  DecideIndentCommand,
  DecideTransferCommand,
  EditIndentCommand,
  GetIndentQuery,
  GetIssueQuery,
  GetRequestQuery,
  GetTransferQuery,
  IndentInboxQuery,
  IndentShortfallQuery,
  ListIndentsQuery,
  ListIssuesQuery,
  ListRequestsQuery,
  ListTransfersQuery,
  RaisePurchaseCommand,
  type IndentAction,
  type IndentSummary,
  type IndentView,
  type IssueSummary,
  type IssueView,
  type RequestSummary,
  type RequestView,
  type ShortfallLine,
  type TransferSummary,
  type TransferView,
} from '../application/store.messages.js';
import type { StoreRef } from '../domain/repositories.js';
import {
  CreatedDocumentResponseDto,
  DecisionResultResponseDto,
  VersionDto,
  VersionQueryDto,
} from './dto/purchase.dto.js';
import {
  CreatedTransferResponseDto,
  CreateIndentDto,
  CreateIssueDto,
  CreateRequestDto,
  CreateTransferDto,
  DecideIndentDto,
  DecideTransferDto,
  EditIndentDto,
  IndentInboxResponseDto,
  IndentPageResponseDto,
  IndentResponseDto,
  IssuePageResponseDto,
  IssueResponseDto,
  RaisePurchaseDto,
  RequestPageResponseDto,
  RequestResponseDto,
  ShortfallQueryDto,
  ShortfallResponseDto,
  StoreListQueryDto,
  TransferPageResponseDto,
  TransferResponseDto,
} from './dto/store.dto.js';

const storeOf = (side: { mainStoreId?: string | undefined; subStoreId?: string | undefined }): StoreRef =>
  side.mainStoreId ? { mainStoreId: side.mainStoreId } : { subStoreId: side.subStoreId! };

@ApiTags('supply-chain')
@ApiBearerAuth()
@Controller({ path: 'scm/store-indents', version: '1' })
export class StoreIndentsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @RequirePermissions('scm:read')
  @ApiOkResponse({ type: IndentPageResponseDto })
  list(@CurrentUser() actor: Actor, @Query() query: StoreListQueryDto): Promise<Page<IndentSummary>> {
    return this.queryBus.execute(new ListIndentsQuery(actor, query));
  }

  @Get('inbox')
  @ApiOperation({ summary: 'Pending indents waiting for one of your roles' })
  @ApiOkResponse({ type: IndentInboxResponseDto })
  async inbox(@CurrentUser() actor: Actor): Promise<{ items: IndentSummary[] }> {
    return { items: await this.queryBus.execute(new IndentInboxQuery(actor)) };
  }

  @Post()
  @RequirePermissions('scm:indent')
  @ApiOperation({ summary: 'Draft a store indent' })
  @ApiCreatedResponse({ type: CreatedDocumentResponseDto })
  create(@CurrentUser() actor: Actor, @Body() dto: CreateIndentDto) {
    const { lines, ...header } = dto;
    return this.commandBus.execute(new CreateIndentCommand(actor, header, lines));
  }

  @Get(':id')
  @RequirePermissions('scm:read')
  @ApiOkResponse({ type: IndentResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto): Promise<IndentView> {
    return this.queryBus.execute(new GetIndentQuery(actor, params.id));
  }

  @Get(':id/shortfall')
  @RequirePermissions('scm:read')
  @ApiOperation({ summary: 'What is approved and not issued, less what the sub-store holds' })
  @ApiOkResponse({ type: ShortfallResponseDto })
  async shortfall(
    @CurrentUser() actor: Actor,
    @Param() params: IdParamDto,
    @Query() query: ShortfallQueryDto,
  ): Promise<{ items: ShortfallLine[] }> {
    return { items: await this.queryBus.execute(new IndentShortfallQuery(actor, params.id, query.on)) };
  }

  @Patch(':id')
  @RequirePermissions('scm:indent')
  @HttpCode(HttpStatus.NO_CONTENT)
  async edit(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: EditIndentDto) {
    const { version, lines, ...header } = dto;
    await this.commandBus.execute(new EditIndentCommand(actor, params.id, version, header, lines));
  }

  @Post(':id/decision')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve (optionally lowering quantities) or reject at the current level' })
  @ApiOkResponse({ type: DecisionResultResponseDto })
  decide(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: DecideIndentDto) {
    return this.commandBus.execute(
      new DecideIndentCommand(
        actor,
        params.id,
        dto.version,
        dto.decision,
        dto.remarks,
        new Map(dto.quantities.map((line) => [line.variantId, line.approvedQty])),
      ),
    );
  }

  @Post(':id/submit')
  @RequirePermissions('scm:indent')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Send a draft to the sub-store's first approval level" })
  async submit(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: VersionDto) {
    await this.act(actor, params.id, dto.version, 'submit');
  }

  @Post(':id/cancel')
  @RequirePermissions('scm:indent')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel an indent, or stop waiting for the rest of a partly served one' })
  async cancel(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: VersionDto) {
    await this.act(actor, params.id, dto.version, 'cancel');
  }

  @Post(':id/acknowledge')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'The person who raised a served indent confirms the goods arrived' })
  async acknowledge(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: VersionDto) {
    await this.act(actor, params.id, dto.version, 'acknowledge');
  }

  private act(actor: Actor, id: string, version: number, action: IndentAction): Promise<void> {
    return this.commandBus.execute(new ActOnIndentCommand(actor, id, version, action));
  }

  @Delete(':id')
  @RequirePermissions('scm:indent')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Query() query: VersionQueryDto) {
    await this.commandBus.execute(new ActOnIndentCommand(actor, params.id, query.version, 'delete'));
  }
}

@ApiTags('supply-chain')
@ApiBearerAuth()
@Controller({ path: 'scm/store-requests', version: '1' })
export class StoreRequestsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @RequirePermissions('scm:read')
  @ApiOkResponse({ type: RequestPageResponseDto })
  list(@CurrentUser() actor: Actor, @Query() query: StoreListQueryDto): Promise<Page<RequestSummary>> {
    return this.queryBus.execute(new ListRequestsQuery(actor, query));
  }

  @Post()
  @RequirePermissions('scm:indent')
  @ApiOperation({ summary: "Ask the sub-store's main store for goods" })
  @ApiCreatedResponse({ type: CreatedDocumentResponseDto })
  create(@CurrentUser() actor: Actor, @Body() dto: CreateRequestDto) {
    return this.commandBus.execute(
      new CreateRequestCommand(actor, dto.subStoreId, dto.requestDate, dto.note, dto.lines),
    );
  }

  @Get(':id')
  @RequirePermissions('scm:read')
  @ApiOkResponse({ type: RequestResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto): Promise<RequestView> {
    return this.queryBus.execute(new GetRequestQuery(actor, params.id));
  }

  @Post(':id/close')
  @RequirePermissions('scm:indent')
  @HttpCode(HttpStatus.NO_CONTENT)
  async close(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: VersionDto) {
    await this.commandBus.execute(new CloseRequestCommand(actor, params.id, dto.version));
  }

  @Post(':id/purchase-requisition')
  @RequirePermissions('scm:purchase')
  @ApiOperation({ summary: 'Raise a draft purchase requisition for what is still outstanding' })
  @ApiCreatedResponse({ type: CreatedDocumentResponseDto })
  purchase(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: RaisePurchaseDto) {
    return this.commandBus.execute(new RaisePurchaseCommand(actor, params.id, dto.version, dto.requisitionDate));
  }
}

@ApiTags('supply-chain')
@ApiBearerAuth()
@Controller({ path: 'scm/store-issues', version: '1' })
export class StoreIssuesController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @RequirePermissions('scm:read')
  @ApiOkResponse({ type: IssuePageResponseDto })
  list(@CurrentUser() actor: Actor, @Query() query: StoreListQueryDto): Promise<Page<IssueSummary>> {
    return this.queryBus.execute(new ListIssuesQuery(actor, query));
  }

  @Post()
  @RequirePermissions('scm:issue')
  @ApiOperation({ summary: 'Issue goods from a sub-store to a department, against an indent or not' })
  @ApiCreatedResponse({ type: CreatedDocumentResponseDto })
  create(@CurrentUser() actor: Actor, @Body() dto: CreateIssueDto) {
    return this.commandBus.execute(new CreateIssueCommand(actor, dto));
  }

  @Get(':id')
  @RequirePermissions('scm:read')
  @ApiOkResponse({ type: IssueResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto): Promise<IssueView> {
    return this.queryBus.execute(new GetIssueQuery(actor, params.id));
  }
}

@ApiTags('supply-chain')
@ApiBearerAuth()
@Controller({ path: 'scm/stock-transfers', version: '1' })
export class StockTransfersController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @RequirePermissions('scm:read')
  @ApiOkResponse({ type: TransferPageResponseDto })
  list(@CurrentUser() actor: Actor, @Query() query: StoreListQueryDto): Promise<Page<TransferSummary>> {
    return this.queryBus.execute(new ListTransfersQuery(actor, query));
  }

  @Post()
  @RequirePermissions('scm:issue')
  @ApiOperation({ summary: 'Transfer between stores; sub-store to sub-store waits for the receiver' })
  @ApiCreatedResponse({ type: CreatedTransferResponseDto })
  create(@CurrentUser() actor: Actor, @Body() dto: CreateTransferDto) {
    return this.commandBus.execute(
      new CreateTransferCommand(actor, { ...dto, from: storeOf(dto.from), to: storeOf(dto.to) }),
    );
  }

  @Get(':id')
  @RequirePermissions('scm:read')
  @ApiOkResponse({ type: TransferResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto): Promise<TransferView> {
    return this.queryBus.execute(new GetTransferQuery(actor, params.id));
  }

  @Post(':id/decision')
  @RequirePermissions('scm:issue')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'The receiving sub-store accepts (possibly less) or rejects a pending transfer' })
  @ApiOkResponse({ type: DecisionResultResponseDto })
  decide(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: DecideTransferDto) {
    return this.commandBus.execute(
      new DecideTransferCommand(
        actor,
        params.id,
        dto.version,
        dto.decision,
        dto.reason,
        new Map(dto.accepted.map((line) => [line.line - 1, line.qty])),
        dto.on,
      ),
    );
  }
}

export const STORE_CONTROLLERS = [
  StoreIndentsController,
  StoreRequestsController,
  StoreIssuesController,
  StockTransfersController,
];
