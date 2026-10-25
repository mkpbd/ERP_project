import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor } from '../../../shared/application/actor.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import { createRecordController } from '../../../shared/presentation/record-controller.js';
import {
  ComputeIncomeTaxCommand,
  GetTaxCertificateQuery,
  ListIncomeTaxQuery,
  SetIncomeTaxCommand,
  type IncomeTaxDeductionView,
  type TaxCertificateView,
} from '../application/income-tax.handlers.js';
import { INCOME_TAX_YEAR } from '../application/payroll.constants.js';
import {
  CertificateParamDto,
  CertificateQueryDto,
  ComputeResultResponseDto,
  CreateTaxYearDto,
  IncomeTaxDeductionResponseDto,
  SetIncomeTaxDto,
  TaxCertificateResponseDto,
  TaxOverrideParamDto,
  TaxPeriodParamDto,
  TaxYearResponseDto,
  UpdateTaxYearDto,
} from './dto/income-tax.dto.js';

export const TaxYearsController = createRecordController({
  tag: 'payroll-income-tax',
  managePermission: 'payroll:manage',
  className: 'TaxYearsController',
  path: 'payroll/tax-years',
  type: INCOME_TAX_YEAR,
  label: 'income tax year',
  create: CreateTaxYearDto,
  update: UpdateTaxYearDto,
  response: TaxYearResponseDto,
});

@ApiTags('payroll-income-tax')
@ApiBearerAuth()
@Controller({ path: 'payroll/income-tax/:year/:month', version: '1' })
export class IncomeTaxController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @RequirePermissions('payroll:read')
  @ApiOperation({ summary: "The month's tax deductions, worked out or entered by hand" })
  @ApiOkResponse({ type: IncomeTaxDeductionResponseDto, isArray: true })
  list(@CurrentUser() actor: Actor, @Param() params: TaxPeriodParamDto): Promise<IncomeTaxDeductionView[]> {
    return this.queryBus.execute(new ListIncomeTaxQuery(actor, params.year, params.month));
  }

  @Post('compute')
  @RequirePermissions('payroll:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Work out everyone’s deduction from the tax year so far (entries made by hand are kept)',
  })
  @ApiOkResponse({ type: ComputeResultResponseDto })
  compute(@CurrentUser() actor: Actor, @Param() params: TaxPeriodParamDto) {
    return this.commandBus.execute(new ComputeIncomeTaxCommand(actor, params.year, params.month));
  }

  @Put(':staffId')
  @RequirePermissions('payroll:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Enter a person's deduction by hand; monthlyTax null removes the entry" })
  @ApiNoContentResponse()
  async set(
    @CurrentUser() actor: Actor,
    @Param() params: TaxOverrideParamDto,
    @Body() dto: SetIncomeTaxDto,
  ): Promise<void> {
    await this.commandBus.execute(
      new SetIncomeTaxCommand(actor, params.year, params.month, params.staffId, dto.monthlyTax, dto.remarks),
    );
  }
}

@ApiTags('payroll-income-tax')
@ApiBearerAuth()
@Controller({ path: 'payroll/tax-certificates', version: '1' })
export class TaxCertificatesController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get(':taxYearId')
  @ApiOperation({ summary: 'Salary certificate for income tax, so far. Your own without staffId.' })
  @ApiOkResponse({ type: TaxCertificateResponseDto })
  get(
    @CurrentUser() actor: Actor,
    @Param() params: CertificateParamDto,
    @Query() query: CertificateQueryDto,
  ): Promise<TaxCertificateView> {
    return this.queryBus.execute(new GetTaxCertificateQuery(actor, params.taxYearId, query.staffId));
  }
}
