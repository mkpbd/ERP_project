import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor } from '../../../shared/application/actor.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import { createRecordController } from '../../../shared/presentation/record-controller.js';
import {
  ALLOWANCE_PAYMENT,
  SALARY_ARREAR,
  SALARY_DEDUCTION,
  SALARY_OVERTIME,
  SALARY_PAYMENT,
  SALARY_PUNISHMENT,
  SALARY_STOP,
} from '../application/payroll.constants.js';
import {
  ApproveSalarySheetCommand,
  CommitSalarySheetCommand,
  GetPayslipQuery,
  GetSalarySheetQuery,
  PreviewSalarySheetQuery,
  type SalarySheetView,
} from '../application/salary-sheet.messages.js';
import type { SalarySheetLine } from '../domain/repositories.js';
import {
  AllowancePaymentResponseDto,
  ApproveResultResponseDto,
  ArrearResponseDto,
  CreateAllowancePaymentDto,
  CreateArrearDto,
  CreateDeductionDto,
  CreateOvertimeDto,
  CreatePunishmentDto,
  CreateSalaryPaymentDto,
  CreateSalaryStopDto,
  DeductionResponseDto,
  MonthlyInputFilterDto,
  OvertimeResponseDto,
  PayslipParamDto,
  PunishmentResponseDto,
  SalaryPaymentResponseDto,
  SalarySheetLineResponseDto,
  SalarySheetResponseDto,
  SalaryStopFilterDto,
  SalaryStopResponseDto,
  SheetPeriodParamDto,
  SheetQueryDto,
  UpdateAllowancePaymentDto,
  UpdateArrearDto,
  UpdateDeductionDto,
  UpdateOvertimeDto,
  UpdatePunishmentDto,
  UpdateSalaryPaymentDto,
  UpdateSalaryStopDto,
} from './dto/monthly.dto.js';

const monthly = { tag: 'payroll-monthly', readPermission: 'payroll:read', managePermission: 'payroll:manage' } as const;

export const OvertimesController = createRecordController({
  ...monthly,
  className: 'OvertimesController',
  path: 'payroll/overtimes',
  type: SALARY_OVERTIME,
  label: 'overtime entry',
  create: CreateOvertimeDto,
  update: UpdateOvertimeDto,
  response: OvertimeResponseDto,
  filter: MonthlyInputFilterDto,
});

export const DeductionsController = createRecordController({
  ...monthly,
  className: 'DeductionsController',
  path: 'payroll/deductions',
  type: SALARY_DEDUCTION,
  label: 'salary deduction',
  create: CreateDeductionDto,
  update: UpdateDeductionDto,
  response: DeductionResponseDto,
  filter: MonthlyInputFilterDto,
});

export const PunishmentsController = createRecordController({
  ...monthly,
  className: 'PunishmentsController',
  path: 'payroll/punishments',
  type: SALARY_PUNISHMENT,
  label: 'salary punishment',
  create: CreatePunishmentDto,
  update: UpdatePunishmentDto,
  response: PunishmentResponseDto,
  filter: MonthlyInputFilterDto,
});

export const ArrearsController = createRecordController({
  ...monthly,
  className: 'ArrearsController',
  path: 'payroll/arrears',
  type: SALARY_ARREAR,
  label: 'salary arrear',
  create: CreateArrearDto,
  update: UpdateArrearDto,
  response: ArrearResponseDto,
  filter: MonthlyInputFilterDto,
});

export const AllowancePaymentsController = createRecordController({
  ...monthly,
  className: 'AllowancePaymentsController',
  path: 'payroll/allowance-payments',
  type: ALLOWANCE_PAYMENT,
  label: 'allowance payment',
  create: CreateAllowancePaymentDto,
  update: UpdateAllowancePaymentDto,
  response: AllowancePaymentResponseDto,
  filter: MonthlyInputFilterDto,
});

export const SalaryPaymentsController = createRecordController({
  ...monthly,
  className: 'SalaryPaymentsController',
  path: 'payroll/salary-payments',
  type: SALARY_PAYMENT,
  label: 'salary payment',
  create: CreateSalaryPaymentDto,
  update: UpdateSalaryPaymentDto,
  response: SalaryPaymentResponseDto,
  filter: MonthlyInputFilterDto,
});

export const SalaryStopsController = createRecordController({
  ...monthly,
  className: 'SalaryStopsController',
  path: 'payroll/salary-stops',
  type: SALARY_STOP,
  label: 'salary stop',
  create: CreateSalaryStopDto,
  update: UpdateSalaryStopDto,
  response: SalaryStopResponseDto,
  filter: SalaryStopFilterDto,
});

@ApiTags('payroll-monthly')
@ApiBearerAuth()
@Controller({ path: 'payroll/salary-sheets/:year/:month', version: '1' })
export class SalarySheetsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @RequirePermissions('payroll:read')
  @ApiOperation({ summary: 'The approved sheet as saved' })
  @ApiOkResponse({ type: SalarySheetResponseDto })
  get(
    @CurrentUser() actor: Actor,
    @Param() params: SheetPeriodParamDto,
    @Query() query: SheetQueryDto,
  ): Promise<SalarySheetView> {
    return this.queryBus.execute(new GetSalarySheetQuery(actor, params.year, params.month, query.departmentId));
  }

  @Get('preview')
  @RequirePermissions('payroll:read')
  @ApiOperation({ summary: 'Work the sheet out from current salaries and inputs, without saving' })
  @ApiOkResponse({ type: SalarySheetResponseDto })
  preview(
    @CurrentUser() actor: Actor,
    @Param() params: SheetPeriodParamDto,
    @Query() query: SheetQueryDto,
  ): Promise<SalarySheetView> {
    return this.queryBus.execute(new PreviewSalarySheetQuery(actor, params.year, params.month, query.departmentId));
  }

  @Post('approve')
  @RequirePermissions('payroll:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save the sheet as worked out now (again replaces it, until committed)' })
  @ApiOkResponse({ type: ApproveResultResponseDto })
  approve(@CurrentUser() actor: Actor, @Param() params: SheetPeriodParamDto) {
    return this.commandBus.execute(new ApproveSalarySheetCommand(actor, params.year, params.month));
  }

  @Post('commit')
  @RequirePermissions('payroll:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Make the approved sheet final; the month's inputs and increments are frozen" })
  @ApiNoContentResponse()
  async commit(@CurrentUser() actor: Actor, @Param() params: SheetPeriodParamDto): Promise<void> {
    await this.commandBus.execute(new CommitSalarySheetCommand(actor, params.year, params.month));
  }

  @Get('payslips/me')
  @ApiOperation({ summary: 'Your own payslip from the approved sheet' })
  @ApiOkResponse({ type: SalarySheetLineResponseDto })
  mine(@CurrentUser() actor: Actor, @Param() params: SheetPeriodParamDto): Promise<SalarySheetLine> {
    return this.queryBus.execute(new GetPayslipQuery(actor, params.year, params.month));
  }

  @Get('payslips/:staffId')
  @ApiOperation({ summary: "A person's payslip. Requires payroll:read unless it is yours." })
  @ApiOkResponse({ type: SalarySheetLineResponseDto })
  payslip(@CurrentUser() actor: Actor, @Param() params: PayslipParamDto): Promise<SalarySheetLine> {
    return this.queryBus.execute(new GetPayslipQuery(actor, params.year, params.month, params.staffId));
  }
}
