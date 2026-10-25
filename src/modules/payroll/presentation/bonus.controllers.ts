import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor } from '../../../shared/application/actor.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import { createRecordController } from '../../../shared/presentation/record-controller.js';
import { IdParamDto } from '../../../shared/presentation/zod/common.schemas.js';
import {
  ActOnFestivalBonusCommand,
  ApproveLeaveEncashmentCommand,
  GetFestivalBonusSheetQuery,
  GetLeaveEncashmentQuery,
  PreviewFestivalBonusQuery,
  PreviewLeaveEncashmentQuery,
  RemoveLeaveEncashmentCommand,
  type FestivalBonusAction,
  type LeaveEncashmentView,
} from '../application/bonus.messages.js';
import { GetDuesStatementQuery, GetPfStatementQuery } from '../application/ledger.handlers.js';
import { FESTIVAL_BONUS, PF_LEDGER_ENTRY, STAFF_DUE } from '../application/payroll.constants.js';
import type { FestivalBonusSheet, LedgerStatement } from '../application/read-models.js';
import {
  CreateFestivalBonusDto,
  CreatePfEntryDto,
  CreateStaffDueDto,
  EncashmentApproveDto,
  EncashmentOptionsDto,
  EncashmentPeriodParamDto,
  FestivalBonusFilterDto,
  FestivalBonusResponseDto,
  FestivalBonusSheetResponseDto,
  LeaveEncashmentResponseDto,
  LedgerFilterDto,
  PfEntryResponseDto,
  RemovedResponseDto,
  SheetResultResponseDto,
  StaffDueFilterDto,
  StaffDueResponseDto,
  StatementQueryDto,
  StatementResponseDto,
  UpdateFestivalBonusDto,
  UpdatePfEntryDto,
  UpdateStaffDueDto,
} from './dto/bonus.dto.js';

const payroll = { tag: 'payroll-bonus', readPermission: 'payroll:read', managePermission: 'payroll:manage' } as const;

export const FestivalBonusesController = createRecordController({
  ...payroll,
  className: 'FestivalBonusesController',
  path: 'payroll/festival-bonuses',
  type: FESTIVAL_BONUS,
  label: 'festival bonus',
  create: CreateFestivalBonusDto,
  update: UpdateFestivalBonusDto,
  response: FestivalBonusResponseDto,
  filter: FestivalBonusFilterDto,
});

export const PfLedgerController = createRecordController({
  ...payroll,
  tag: 'payroll-ledgers',
  className: 'PfLedgerController',
  path: 'payroll/pf-ledger',
  type: PF_LEDGER_ENTRY,
  label: 'PF ledger entry',
  create: CreatePfEntryDto,
  update: UpdatePfEntryDto,
  response: PfEntryResponseDto,
  filter: LedgerFilterDto,
});

export const StaffDuesController = createRecordController({
  ...payroll,
  tag: 'payroll-ledgers',
  className: 'StaffDuesController',
  path: 'payroll/staff-dues',
  type: STAFF_DUE,
  label: 'staff due entry',
  create: CreateStaffDueDto,
  update: UpdateStaffDueDto,
  response: StaffDueResponseDto,
  filter: StaffDueFilterDto,
});

@ApiTags('payroll-bonus')
@ApiBearerAuth()
@Controller({ path: 'payroll/festival-bonuses/:id/sheet', version: '1' })
export class FestivalBonusSheetController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @RequirePermissions('payroll:read')
  @ApiOperation({ summary: 'The saved bonus sheet (status null and no lines before approval)' })
  @ApiOkResponse({ type: FestivalBonusSheetResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto): Promise<FestivalBonusSheet> {
    return this.queryBus.execute(new GetFestivalBonusSheetQuery(actor, params.id));
  }

  @Get('preview')
  @RequirePermissions('payroll:read')
  @ApiOperation({ summary: 'Work the bonus sheet out now from the previous month’s salary sheet, without saving' })
  @ApiOkResponse({ type: FestivalBonusSheetResponseDto })
  preview(@CurrentUser() actor: Actor, @Param() params: IdParamDto): Promise<FestivalBonusSheet> {
    return this.queryBus.execute(new PreviewFestivalBonusQuery(actor, params.id));
  }

  @Post('approve')
  @RequirePermissions('payroll:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SheetResultResponseDto })
  approve(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.act(actor, params.id, 'approve');
  }

  @Post('commit')
  @RequirePermissions('payroll:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SheetResultResponseDto })
  commit(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.act(actor, params.id, 'commit');
  }

  @Post('reverse')
  @RequirePermissions('payroll:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete an uncommitted bonus sheet' })
  @ApiOkResponse({ type: SheetResultResponseDto })
  reverse(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.act(actor, params.id, 'reverse');
  }

  private act(actor: Actor, id: string, action: FestivalBonusAction): Promise<{ lines: number; amount: number }> {
    return this.commandBus.execute(new ActOnFestivalBonusCommand(actor, id, action));
  }
}

@ApiTags('payroll-bonus')
@ApiBearerAuth()
@Controller({ path: 'payroll/leave-encashments/:year/:month', version: '1' })
export class LeaveEncashmentsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @RequirePermissions('payroll:read')
  @ApiOkResponse({ type: LeaveEncashmentResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: EncashmentPeriodParamDto): Promise<LeaveEncashmentView> {
    return this.queryBus.execute(new GetLeaveEncashmentQuery(actor, params.year, params.month));
  }

  @Get('preview')
  @RequirePermissions('payroll:read')
  @ApiOperation({
    summary: "Unused leave of the calendar year, paid at gross ÷ 30 a day, from the month's salary sheet",
  })
  @ApiOkResponse({ type: LeaveEncashmentResponseDto })
  preview(
    @CurrentUser() actor: Actor,
    @Param() params: EncashmentPeriodParamDto,
    @Query() query: EncashmentOptionsDto,
  ): Promise<LeaveEncashmentView> {
    return this.queryBus.execute(
      new PreviewLeaveEncashmentQuery(actor, params.year, params.month, query.yearlyLeaveDays),
    );
  }

  @Post()
  @RequirePermissions('payroll:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Save the month's encashment as worked out now (replaces what was saved)" })
  @ApiOkResponse({ type: SheetResultResponseDto })
  approve(@CurrentUser() actor: Actor, @Param() params: EncashmentPeriodParamDto, @Body() dto: EncashmentApproveDto) {
    return this.commandBus.execute(
      new ApproveLeaveEncashmentCommand(actor, params.year, params.month, dto.yearlyLeaveDays),
    );
  }

  @Delete()
  @RequirePermissions('payroll:manage')
  @ApiOkResponse({ type: RemovedResponseDto })
  remove(@CurrentUser() actor: Actor, @Param() params: EncashmentPeriodParamDto) {
    return this.commandBus.execute(new RemoveLeaveEncashmentCommand(actor, params.year, params.month));
  }
}

@ApiTags('payroll-ledgers')
@ApiBearerAuth()
@Controller({ path: 'payroll/statements', version: '1' })
export class LedgerStatementsController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get('pf')
  @ApiOperation({ summary: 'PF account with running balance. Your own without staffId; others need payroll:read.' })
  @ApiOkResponse({ type: StatementResponseDto })
  pf(@CurrentUser() actor: Actor, @Query() query: StatementQueryDto): Promise<LedgerStatement> {
    return this.queryBus.execute(new GetPfStatementQuery(actor, query.from, query.to, query.staffId));
  }

  @Get('dues')
  @ApiOperation({ summary: 'Dues owed to service units with running balance. Your own without staffId.' })
  @ApiOkResponse({ type: StatementResponseDto })
  dues(@CurrentUser() actor: Actor, @Query() query: StatementQueryDto): Promise<LedgerStatement> {
    return this.queryBus.execute(
      new GetDuesStatementQuery(actor, query.from, query.to, query.staffId, query.serviceUnitId),
    );
  }
}
