import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page } from '../../../shared/application/pagination.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import { IdParamDto } from '../../../shared/presentation/zod/common.schemas.js';
import {
  CancelConsumptionCommand,
  DecideAdjustmentCommand,
  DecideDepartmentReturnCommand,
  DeleteSupplierReturnCommand,
  DraftSupplierReturnCommand,
  EditSupplierReturnCommand,
  GetDepartmentDocumentQuery,
  IssueGatePassCommand,
  ListDepartmentDocumentsQuery,
  OpenDepartmentReturnCommand,
  PostConsumptionCommand,
  RequestAdjustmentCommand,
  SendSupplierReturnCommand,
  SettleSupplierReturnCommand,
  type DepartmentDocumentKind,
  type DocumentSummary,
  type DocumentView,
} from '../application/department.messages.js';
import { CreatedDocumentResponseDto, VersionDto, VersionQueryDto } from './dto/purchase.dto.js';
import {
  CancelConsumptionDto,
  DecideCountDto,
  DecideDepartmentReturnDto,
  DepartmentListQueryDto,
  DocumentPageResponseDto,
  DocumentResponseDto,
  DraftSupplierReturnDto,
  EditSupplierReturnDto,
  IssueGatePassDto,
  OpenDepartmentReturnDto,
  PostConsumptionDto,
  RequestCountDto,
  SentReturnResponseDto,
  SettleSupplierReturnDto,
  VoucherResultResponseDto,
} from './dto/department.dto.js';

/** List and detail of one kind of department document. Subclasses repeat the constructor so Nest injects them. */
abstract class DocumentReads {
  protected abstract readonly kind: DepartmentDocumentKind;

  constructor(
    protected readonly commandBus: CommandBus,
    protected readonly queryBus: QueryBus,
  ) {}

  @Get()
  @RequirePermissions('scm:read')
  @ApiOkResponse({ type: DocumentPageResponseDto })
  list(@CurrentUser() actor: Actor, @Query() query: DepartmentListQueryDto): Promise<Page<DocumentSummary>> {
    return this.queryBus.execute(new ListDepartmentDocumentsQuery(actor, this.kind, query));
  }

  @Get(':id')
  @RequirePermissions('scm:read')
  @ApiOkResponse({ type: DocumentResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto): Promise<DocumentView> {
    return this.queryBus.execute(new GetDepartmentDocumentQuery(actor, this.kind, params.id));
  }
}

@ApiTags('supply-chain')
@ApiBearerAuth()
@Controller({ path: 'scm/department-consumptions', version: '1' })
export class DepartmentConsumptionsController extends DocumentReads {
  protected readonly kind = 'consumption';

  constructor(commandBus: CommandBus, queryBus: QueryBus) {
    super(commandBus, queryBus);
  }

  @Post()
  @RequirePermissions('scm:department')
  @ApiOperation({ summary: 'Record what a department used up (out of its stock at once)' })
  @ApiCreatedResponse({ type: CreatedDocumentResponseDto })
  post(@CurrentUser() actor: Actor, @Body() dto: PostConsumptionDto) {
    return this.commandBus.execute(
      new PostConsumptionCommand(actor, dto.departmentId, dto.consumedOn, dto.note, dto.lines),
    );
  }

  @Post(':id/cancel')
  @RequirePermissions('scm:department')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel a consumption; the same lots go back to the department' })
  async cancel(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: CancelConsumptionDto) {
    await this.commandBus.execute(new CancelConsumptionCommand(actor, params.id, dto.version, dto.reason, dto.on));
  }
}

@ApiTags('supply-chain')
@ApiBearerAuth()
@Controller({ path: 'scm/department-returns', version: '1' })
export class DepartmentReturnsController extends DocumentReads {
  protected readonly kind = 'return';

  constructor(commandBus: CommandBus, queryBus: QueryBus) {
    super(commandBus, queryBus);
  }

  @Post()
  @RequirePermissions('scm:department')
  @ApiOperation({ summary: 'Send goods from a department back to a sub-store (moves when received)' })
  @ApiCreatedResponse({ type: CreatedDocumentResponseDto })
  open(@CurrentUser() actor: Actor, @Body() dto: OpenDepartmentReturnDto) {
    return this.commandBus.execute(
      new OpenDepartmentReturnCommand(actor, dto.departmentId, dto.subStoreId, dto.returnDate, dto.reason, dto.lines),
    );
  }

  @Post(':id/decision')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'The sub-store receives the return, or the department cancels it' })
  async decide(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: DecideDepartmentReturnDto) {
    await this.commandBus.execute(
      new DecideDepartmentReturnCommand(actor, params.id, dto.version, dto.decision, dto.on),
    );
  }
}

@ApiTags('supply-chain')
@ApiBearerAuth()
@Controller({ path: 'scm/department-counts', version: '1' })
export class DepartmentCountsController extends DocumentReads {
  protected readonly kind = 'adjustment';

  constructor(commandBus: CommandBus, queryBus: QueryBus) {
    super(commandBus, queryBus);
  }

  @Post()
  @RequirePermissions('scm:department')
  @ApiOperation({ summary: "Record a department's physical count by lot, for approval" })
  @ApiCreatedResponse({ type: CreatedDocumentResponseDto })
  request(@CurrentUser() actor: Actor, @Body() dto: RequestCountDto) {
    return this.commandBus.execute(
      new RequestAdjustmentCommand(actor, dto.departmentId, dto.countedOn, dto.reason, dto.lines),
    );
  }

  @Post(':id/decision')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Approve (scm:adjust, not the counter) or reject a count; cancel a pending one' })
  async decide(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: DecideCountDto) {
    await this.commandBus.execute(
      new DecideAdjustmentCommand(actor, params.id, dto.version, dto.decision, dto.remarks),
    );
  }
}

@ApiTags('supply-chain')
@ApiBearerAuth()
@Controller({ path: 'scm/supplier-returns', version: '1' })
export class SupplierReturnsController extends DocumentReads {
  protected readonly kind = 'supplier_return';

  constructor(commandBus: CommandBus, queryBus: QueryBus) {
    super(commandBus, queryBus);
  }

  @Post()
  @RequirePermissions('scm:receive')
  @ApiOperation({ summary: 'Draft a return of goods from a main store to a supplier' })
  @ApiCreatedResponse({ type: CreatedDocumentResponseDto })
  draft(@CurrentUser() actor: Actor, @Body() dto: DraftSupplierReturnDto) {
    return this.commandBus.execute(
      new DraftSupplierReturnCommand(actor, dto.mainStoreId, dto.supplierId, dto.returnDate, dto.reason, dto.lines),
    );
  }

  @Patch(':id')
  @RequirePermissions('scm:receive')
  @HttpCode(HttpStatus.NO_CONTENT)
  async edit(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: EditSupplierReturnDto) {
    const { version, ...changes } = dto;
    await this.commandBus.execute(new EditSupplierReturnCommand(actor, params.id, version, changes));
  }

  @Delete(':id')
  @RequirePermissions('scm:receive')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Query() query: VersionQueryDto) {
    await this.commandBus.execute(new DeleteSupplierReturnCommand(actor, params.id, query.version));
  }

  @Post(':id/send')
  @RequirePermissions('scm:receive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send the goods: out of stock, a gate pass and a debit note to the supplier' })
  @ApiOkResponse({ type: SentReturnResponseDto })
  send(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: VersionDto) {
    return this.commandBus.execute(new SendSupplierReturnCommand(actor, params.id, dto.version));
  }

  @Post(':id/settle')
  @RequirePermissions('scm:receive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record what the supplier sent back for each line (0 for nothing)' })
  @ApiOkResponse({ type: VoucherResultResponseDto })
  settle(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: SettleSupplierReturnDto) {
    return this.commandBus.execute(new SettleSupplierReturnCommand(actor, params.id, dto.version, dto.on, dto.lines));
  }
}

@ApiTags('supply-chain')
@ApiBearerAuth()
@Controller({ path: 'scm/gate-passes', version: '1' })
export class GatePassesController extends DocumentReads {
  protected readonly kind = 'gate_pass';

  constructor(commandBus: CommandBus, queryBus: QueryBus) {
    super(commandBus, queryBus);
  }

  @Post()
  @RequirePermissions('scm:issue')
  @ApiOperation({ summary: 'Issue a gate pass for goods leaving the premises (supplier returns get one themselves)' })
  @ApiCreatedResponse({ type: CreatedDocumentResponseDto })
  issue(@CurrentUser() actor: Actor, @Body() dto: IssueGatePassDto) {
    return this.commandBus.execute(new IssueGatePassCommand(actor, dto));
  }
}

export const DEPARTMENT_CONTROLLERS = [
  DepartmentConsumptionsController,
  DepartmentReturnsController,
  DepartmentCountsController,
  SupplierReturnsController,
  GatePassesController,
];
