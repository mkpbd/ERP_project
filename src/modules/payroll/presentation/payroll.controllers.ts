import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page } from '../../../shared/application/pagination.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import { createRecordController } from '../../../shared/presentation/record-controller.js';
import { SALARY_POLICY, SALARY_REVIEW_CYCLE } from '../application/payroll.constants.js';
import type { IncrementCandidate, SalaryIncrementView, StaffSalaryView } from '../application/read-models.js';
import {
  ApplyIncrementsCommand,
  CommitIncrementsCommand,
  GetIncrementCandidatesQuery,
  GetSalaryQuery,
  ListIncrementsQuery,
  ListSalariesQuery,
  ReverseIncrementsCommand,
  ReviseStaffSalaryCommand,
  SetStaffSalaryCommand,
} from '../application/salary.messages.js';
import {
  ApplyIncrementsDto,
  CountResponseDto,
  CreateReviewCycleDto,
  CreateSalaryPolicyDto,
  IncrementCandidateResponseDto,
  IncrementListQueryDto,
  IncrementResponseDto,
  PayPeriodDto,
  PayPeriodQueryDto,
  ReviewCycleResponseDto,
  ReviseSalaryDto,
  SalaryListQueryDto,
  SalaryPageResponseDto,
  SalaryPolicyResponseDto,
  SalaryResponseDto,
  SetSalaryDto,
  StaffIdParamDto,
  UpdateReviewCycleDto,
  UpdateSalaryPolicyDto,
} from './dto/payroll.dto.js';

const payroll = { tag: 'payroll', managePermission: 'payroll:manage' } as const;

export const SalaryPoliciesController = createRecordController({
  ...payroll,
  className: 'SalaryPoliciesController',
  path: 'payroll/salary-policies',
  type: SALARY_POLICY,
  label: 'salary policy',
  create: CreateSalaryPolicyDto,
  update: UpdateSalaryPolicyDto,
  response: SalaryPolicyResponseDto,
});

export const SalaryReviewCyclesController = createRecordController({
  ...payroll,
  className: 'SalaryReviewCyclesController',
  path: 'payroll/salary-review-cycles',
  type: SALARY_REVIEW_CYCLE,
  label: 'salary review cycle',
  create: CreateReviewCycleDto,
  update: UpdateReviewCycleDto,
  response: ReviewCycleResponseDto,
});

@ApiTags('payroll')
@ApiBearerAuth()
@Controller({ path: 'payroll/salaries', version: '1' })
export class SalariesController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @RequirePermissions('payroll:read')
  @ApiOperation({ summary: 'Salary structures (search by employee number or name)' })
  @ApiOkResponse({ type: SalaryPageResponseDto })
  list(@CurrentUser() actor: Actor, @Query() query: SalaryListQueryDto): Promise<Page<StaffSalaryView>> {
    return this.queryBus.execute(new ListSalariesQuery(actor, query));
  }

  // Declared before ':staffId' so the literal segment wins.
  @Get('me')
  @ApiOperation({ summary: 'Your own salary structure' })
  @ApiOkResponse({ type: SalaryResponseDto })
  mine(@CurrentUser() actor: Actor): Promise<StaffSalaryView> {
    return this.queryBus.execute(new GetSalaryQuery(actor));
  }

  @Get(':staffId')
  @ApiOperation({ summary: "A person's salary structure. Requires payroll:read unless it is yours." })
  @ApiOkResponse({ type: SalaryResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: StaffIdParamDto): Promise<StaffSalaryView> {
    return this.queryBus.execute(new GetSalaryQuery(actor, params.staffId));
  }

  @Put(':staffId')
  @RequirePermissions('payroll:manage')
  @ApiOperation({
    summary:
      "Set up a person's salary from the gross; the policy splits it into basic, house rent, medical, conveyance",
  })
  @ApiOkResponse({ type: SalaryResponseDto })
  async set(
    @CurrentUser() actor: Actor,
    @Param() params: StaffIdParamDto,
    @Body() dto: SetSalaryDto,
  ): Promise<StaffSalaryView> {
    const { gross, ...settings } = dto;
    await this.commandBus.execute(new SetStaffSalaryCommand(actor, params.staffId, gross, settings));
    return this.queryBus.execute(new GetSalaryQuery(actor, params.staffId));
  }

  @Patch(':staffId')
  @RequirePermissions('payroll:manage')
  @ApiOperation({ summary: 'Change the gross or settings; the split is worked out again' })
  @ApiOkResponse({ type: SalaryResponseDto })
  async revise(
    @CurrentUser() actor: Actor,
    @Param() params: StaffIdParamDto,
    @Body() dto: ReviseSalaryDto,
  ): Promise<StaffSalaryView> {
    const { version, gross, ...settings } = dto;
    await this.commandBus.execute(new ReviseStaffSalaryCommand(actor, params.staffId, version, gross, settings));
    return this.queryBus.execute(new GetSalaryQuery(actor, params.staffId));
  }
}

@ApiTags('payroll')
@ApiBearerAuth()
@Controller({ path: 'payroll/increments', version: '1' })
export class IncrementsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @RequirePermissions('payroll:read')
  @ApiOkResponse({ type: IncrementResponseDto, isArray: true })
  list(@CurrentUser() actor: Actor, @Query() query: IncrementListQueryDto): Promise<SalaryIncrementView[]> {
    return this.queryBus.execute(new ListIncrementsQuery(actor, query));
  }

  @Get('candidates')
  @RequirePermissions('payroll:read')
  @ApiOperation({ summary: 'People due an increment in a pay month (joining anniversary in the month before)' })
  @ApiOkResponse({ type: IncrementCandidateResponseDto, isArray: true })
  candidates(@CurrentUser() actor: Actor, @Query() query: PayPeriodQueryDto): Promise<IncrementCandidate[]> {
    return this.queryBus.execute(new GetIncrementCandidatesQuery(actor, query.year, query.month));
  }

  @Post()
  @RequirePermissions('payroll:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apply increments for a pay month (pending until committed)' })
  @ApiOkResponse({ type: CountResponseDto })
  apply(@CurrentUser() actor: Actor, @Body() dto: ApplyIncrementsDto): Promise<{ applied: number }> {
    return this.commandBus.execute(new ApplyIncrementsCommand(actor, dto.year, dto.month, dto.entries));
  }

  @Post('commit')
  @RequirePermissions('payroll:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Commit the month's pending increments (they can no longer be reversed)" })
  @ApiOkResponse({ type: CountResponseDto })
  commit(@CurrentUser() actor: Actor, @Body() dto: PayPeriodDto): Promise<{ committed: number }> {
    return this.commandBus.execute(new CommitIncrementsCommand(actor, dto.year, dto.month));
  }

  @Post('reverse')
  @RequirePermissions('payroll:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Undo the month's pending increments, restoring each salary as it was" })
  @ApiOkResponse({ type: CountResponseDto })
  reverse(@CurrentUser() actor: Actor, @Body() dto: PayPeriodDto): Promise<{ reversed: number }> {
    return this.commandBus.execute(new ReverseIncrementsCommand(actor, dto.year, dto.month));
  }
}
