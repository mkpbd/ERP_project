import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page } from '../../../shared/application/pagination.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import { createRecordController } from '../../../shared/presentation/record-controller.js';
import { IdParamDto } from '../../../shared/presentation/zod/common.schemas.js';
import {
  ApproveLeaveApplicationCommand,
  CancelLeaveApplicationCommand,
  DeleteLeavePolicyCommand,
  GetLeaveApplicationQuery,
  GetLeaveBalanceQuery,
  GetLeavePolicyQuery,
  ListLeaveApplicationsQuery,
  ListLeavePoliciesQuery,
  MyLeaveApplicationsQuery,
  RejectLeaveApplicationCommand,
  SetLeavePolicyCommand,
  SubmitLeaveApplicationCommand,
} from '../application/leave.messages.js';
import type {
  LeaveApplicationDetailView,
  LeaveApplicationView,
  LeaveBalanceView,
  LeavePolicyView,
} from '../application/leave.read-models.js';
import { LEAVE_APPROVAL_LEVEL, LEAVE_DELEGATE, LEAVE_RECORD, LEAVE_TYPE } from '../application/hr.constants.js';
import {
  ApprovalLevelFilterDto,
  ApprovalLevelResponseDto,
  ApproveLeaveDto,
  CreateApprovalLevelDto,
  CreateLeaveDelegateDto,
  CreateLeaveRecordDto,
  CreateLeaveTypeDto,
  LeaveApplicationListQueryDto,
  LeaveApplicationPageResponseDto,
  LeaveApplicationResponseDto,
  LeaveBalanceResponseDto,
  LeaveDecisionReasonDto,
  LeaveDelegateFilterDto,
  LeaveDelegateResponseDto,
  LeavePolicyDto,
  LeavePolicyResponseDto,
  LeaveRecordFilterDto,
  LeaveRecordResponseDto,
  LeaveTypeResponseDto,
  LeaveYearParamDto,
  LeaveYearQueryDto,
  MyLeaveApplicationsQueryDto,
  StaffLeaveYearParamDto,
  SubmitLeaveDto,
  UpdateApprovalLevelDto,
  UpdateLeaveDelegateDto,
  UpdateLeaveRecordDto,
  UpdateLeaveTypeDto,
} from './dto/leave.dto.js';

export const LeaveTypesController = createRecordController({
  tag: 'hr-leave',
  managePermission: 'hr-masters:manage',
  className: 'LeaveTypesController',
  path: 'hr/leave/types',
  type: LEAVE_TYPE,
  label: 'leave type',
  create: CreateLeaveTypeDto,
  update: UpdateLeaveTypeDto,
  response: LeaveTypeResponseDto,
});

export const LeaveApprovalLevelsController = createRecordController({
  tag: 'hr-leave',
  managePermission: 'leave:manage',
  className: 'LeaveApprovalLevelsController',
  path: 'hr/leave/approval-levels',
  type: LEAVE_APPROVAL_LEVEL,
  label: 'leave approval level',
  create: CreateApprovalLevelDto,
  update: UpdateApprovalLevelDto,
  response: ApprovalLevelResponseDto,
  filter: ApprovalLevelFilterDto,
});

export const LeaveDelegatesController = createRecordController({
  tag: 'hr-leave',
  readPermission: 'leave:read',
  managePermission: 'leave:manage',
  className: 'LeaveDelegatesController',
  path: 'hr/leave/delegates',
  type: LEAVE_DELEGATE,
  label: 'leave delegate',
  create: CreateLeaveDelegateDto,
  update: UpdateLeaveDelegateDto,
  response: LeaveDelegateResponseDto,
  filter: LeaveDelegateFilterDto,
});

export const LeaveRecordsController = createRecordController({
  tag: 'hr-leave',
  readPermission: 'leave:read',
  managePermission: 'leave:manage',
  className: 'LeaveRecordsController',
  path: 'hr/leave/records',
  type: LEAVE_RECORD,
  label: 'recorded leave',
  create: CreateLeaveRecordDto,
  update: UpdateLeaveRecordDto,
  response: LeaveRecordResponseDto,
  filter: LeaveRecordFilterDto,
});

@ApiTags('hr-leave')
@ApiBearerAuth()
@Controller({ path: 'hr/leave', version: '1' })
export class LeaveApplicationsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('applications')
  @RequirePermissions('leave:read')
  @ApiOperation({ summary: 'All leave applications (filter by staff, department, status, period)' })
  @ApiOkResponse({ type: LeaveApplicationPageResponseDto })
  list(@CurrentUser() actor: Actor, @Query() query: LeaveApplicationListQueryDto): Promise<Page<LeaveApplicationView>> {
    return this.queryBus.execute(new ListLeaveApplicationsQuery(actor, query));
  }

  @Post('applications')
  @ApiOperation({
    summary:
      'Apply for leave: for yourself (linked staff record), for someone you are a delegate of, or for anyone with leave:manage',
  })
  @ApiCreatedResponse({ type: LeaveApplicationResponseDto })
  async submit(@CurrentUser() actor: Actor, @Body() dto: SubmitLeaveDto): Promise<LeaveApplicationDetailView> {
    const { id } = await this.commandBus.execute(new SubmitLeaveApplicationCommand(actor, dto));
    return this.queryBus.execute(new GetLeaveApplicationQuery(actor, id));
  }

  @Get('applications/mine')
  @ApiOperation({ summary: 'Your own leave applications' })
  @ApiOkResponse({ type: LeaveApplicationPageResponseDto })
  mine(@CurrentUser() actor: Actor, @Query() query: MyLeaveApplicationsQueryDto): Promise<Page<LeaveApplicationView>> {
    return this.queryBus.execute(new MyLeaveApplicationsQuery(actor, 'mine', query));
  }

  @Get('applications/awaiting-me')
  @ApiOperation({ summary: 'Pending applications whose current approval level is yours' })
  @ApiOkResponse({ type: LeaveApplicationPageResponseDto })
  awaitingMe(
    @CurrentUser() actor: Actor,
    @Query() query: MyLeaveApplicationsQueryDto,
  ): Promise<Page<LeaveApplicationView>> {
    return this.queryBus.execute(new MyLeaveApplicationsQuery(actor, 'awaiting-me', query));
  }

  @Get('applications/:id')
  @ApiOperation({ summary: 'An application with its approval history and next approver' })
  @ApiOkResponse({ type: LeaveApplicationResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto): Promise<LeaveApplicationDetailView> {
    return this.queryBus.execute(new GetLeaveApplicationQuery(actor, params.id));
  }

  @Post('applications/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve at the current level (you may shorten the period). The last level approves the application.',
  })
  @ApiOkResponse({ type: LeaveApplicationResponseDto })
  async approve(
    @CurrentUser() actor: Actor,
    @Param() params: IdParamDto,
    @Body() dto: ApproveLeaveDto,
  ): Promise<LeaveApplicationDetailView> {
    await this.commandBus.execute(new ApproveLeaveApplicationCommand(actor, params.id, dto));
    return this.queryBus.execute(new GetLeaveApplicationQuery(actor, params.id));
  }

  @Post('applications/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: LeaveApplicationResponseDto })
  async reject(
    @CurrentUser() actor: Actor,
    @Param() params: IdParamDto,
    @Body() dto: LeaveDecisionReasonDto,
  ): Promise<LeaveApplicationDetailView> {
    await this.commandBus.execute(new RejectLeaveApplicationCommand(actor, params.id, dto.reason));
    return this.queryBus.execute(new GetLeaveApplicationQuery(actor, params.id));
  }

  @Post('applications/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Withdraw a pending application (applicant), or cancel an approved one (leave:manage)' })
  @ApiOkResponse({ type: LeaveApplicationResponseDto })
  async cancel(
    @CurrentUser() actor: Actor,
    @Param() params: IdParamDto,
    @Body() dto: LeaveDecisionReasonDto,
  ): Promise<LeaveApplicationDetailView> {
    await this.commandBus.execute(new CancelLeaveApplicationCommand(actor, params.id, dto.reason));
    return this.queryBus.execute(new GetLeaveApplicationQuery(actor, params.id));
  }

  @Get('balance')
  @ApiOperation({ summary: 'Your leave balance for a year' })
  @ApiOkResponse({ type: LeaveBalanceResponseDto, isArray: true })
  myBalance(@CurrentUser() actor: Actor, @Query() query: LeaveYearQueryDto): Promise<LeaveBalanceView[]> {
    return this.queryBus.execute(new GetLeaveBalanceQuery(actor, query.year));
  }

  @Get('policies')
  @RequirePermissions('leave:read')
  @ApiOkResponse({ type: LeavePolicyResponseDto, isArray: true })
  policies(@CurrentUser() actor: Actor): Promise<LeavePolicyView[]> {
    return this.queryBus.execute(new ListLeavePoliciesQuery(actor));
  }

  @Get('policies/:year')
  @RequirePermissions('leave:read')
  @ApiOkResponse({ type: LeavePolicyResponseDto })
  policy(@CurrentUser() actor: Actor, @Param() params: LeaveYearParamDto): Promise<LeavePolicyView> {
    return this.queryBus.execute(new GetLeavePolicyQuery(actor, params.year));
  }

  @Put('policies/:year')
  @RequirePermissions('leave:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Set the year's leave policy (replaces its entitlements)" })
  @ApiNoContentResponse()
  async setPolicy(
    @CurrentUser() actor: Actor,
    @Param() params: LeaveYearParamDto,
    @Body() dto: LeavePolicyDto,
  ): Promise<void> {
    await this.commandBus.execute(new SetLeavePolicyCommand(actor, params.year, dto));
  }

  @Delete('policies/:year')
  @RequirePermissions('leave:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async deletePolicy(@CurrentUser() actor: Actor, @Param() params: LeaveYearParamDto): Promise<void> {
    await this.commandBus.execute(new DeleteLeavePolicyCommand(actor, params.year));
  }
}

@ApiTags('hr-leave')
@ApiBearerAuth()
@Controller({ path: 'hr/staff', version: '1' })
export class StaffLeaveController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get(':id/leave-balance')
  @ApiOperation({
    summary: "A staff member's leave balance. Requires leave:read unless it is you or someone you are a delegate of.",
  })
  @ApiOkResponse({ type: LeaveBalanceResponseDto, isArray: true })
  balance(
    @CurrentUser() actor: Actor,
    @Param() params: IdParamDto,
    @Query() query: LeaveYearQueryDto,
  ): Promise<LeaveBalanceView[]> {
    return this.queryBus.execute(new GetLeaveBalanceQuery(actor, query.year, params.id));
  }

  @Get(':id/leave-policies/:year')
  @RequirePermissions('leave:read')
  @ApiOkResponse({ type: LeavePolicyResponseDto })
  policy(@CurrentUser() actor: Actor, @Param() params: StaffLeaveYearParamDto): Promise<LeavePolicyView> {
    return this.queryBus.execute(new GetLeavePolicyQuery(actor, params.year, params.id));
  }

  @Put(':id/leave-policies/:year')
  @RequirePermissions('leave:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Give one person their own policy for the year (replaces the organization's for them)" })
  @ApiNoContentResponse()
  async setPolicy(
    @CurrentUser() actor: Actor,
    @Param() params: StaffLeaveYearParamDto,
    @Body() dto: LeavePolicyDto,
  ): Promise<void> {
    await this.commandBus.execute(new SetLeavePolicyCommand(actor, params.year, dto, params.id));
  }

  @Delete(':id/leave-policies/:year')
  @RequirePermissions('leave:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async deletePolicy(@CurrentUser() actor: Actor, @Param() params: StaffLeaveYearParamDto): Promise<void> {
    await this.commandBus.execute(new DeleteLeavePolicyCommand(actor, params.year, params.id));
  }
}
