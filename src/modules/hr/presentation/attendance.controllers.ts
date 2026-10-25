import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page } from '../../../shared/application/pagination.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import { IdParamDto } from '../../../shared/presentation/zod/common.schemas.js';
import {
  ActOnManualAttendanceCommand,
  CreateManualAttendanceCommand,
  GetDailyAttendanceQuery,
  GetManualAttendanceContextQuery,
  GetManualAttendanceQuery,
  GetStaffAttendanceQuery,
  IngestPunchesCommand,
  ListManualAttendanceQuery,
  ListPunchesQuery,
  type ManualAction,
  type ManualContextView,
  type PunchIngestResult,
} from '../application/attendance.messages.js';
import type { ManualAttendanceView, StaffAttendanceRow } from '../application/attendance.read-models.js';
import {
  AttendanceDayResponseDto,
  AttendanceRangeQueryDto,
  CreateManualAttendanceDto,
  DailyAttendanceQueryDto,
  EditManualAttendanceDto,
  IngestPunchesDto,
  ManualActionDto,
  ManualAttendanceListQueryDto,
  ManualAttendancePageResponseDto,
  ManualAttendanceResponseDto,
  ManualContextQueryDto,
  ManualContextResponseDto,
  PunchIngestResponseDto,
  PunchResponseDto,
} from './dto/attendance.dto.js';

@ApiTags('hr-attendance')
@ApiBearerAuth()
@Controller({ path: 'hr/attendance', version: '1' })
export class AttendanceController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post('punches')
  @RequirePermissions('attendance:ingest')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Device integration: send raw punches (biometric number, machine, time with offset). Repeats are skipped; unknown biometric numbers are kept and reported.',
  })
  @ApiOkResponse({ type: PunchIngestResponseDto })
  ingest(@CurrentUser() actor: Actor, @Body() dto: IngestPunchesDto): Promise<PunchIngestResult> {
    return this.commandBus.execute(new IngestPunchesCommand(actor, dto.punches));
  }

  @Get('daily')
  @RequirePermissions('attendance:read')
  @ApiOperation({ summary: "Every active employee's attendance on a date" })
  @ApiOkResponse({ type: AttendanceDayResponseDto, isArray: true })
  daily(@CurrentUser() actor: Actor, @Query() query: DailyAttendanceQueryDto): Promise<StaffAttendanceRow[]> {
    const { date, ...scope } = query;
    return this.queryBus.execute(new GetDailyAttendanceQuery(actor, date, scope));
  }

  @Get('me')
  @ApiOperation({ summary: 'Your own attendance, day by day (up to 62 days)' })
  @ApiOkResponse({ type: AttendanceDayResponseDto, isArray: true })
  mine(@CurrentUser() actor: Actor, @Query() query: AttendanceRangeQueryDto): Promise<StaffAttendanceRow[]> {
    return this.queryBus.execute(new GetStaffAttendanceQuery(actor, query.from, query.to));
  }

  @Get('staff/:id')
  @ApiOperation({ summary: "A person's attendance, day by day. Requires attendance:read unless it is you." })
  @ApiOkResponse({ type: AttendanceDayResponseDto, isArray: true })
  staff(
    @CurrentUser() actor: Actor,
    @Param() params: IdParamDto,
    @Query() query: AttendanceRangeQueryDto,
  ): Promise<StaffAttendanceRow[]> {
    return this.queryBus.execute(new GetStaffAttendanceQuery(actor, query.from, query.to, params.id));
  }

  @Get('staff/:id/punches')
  @ApiOperation({ summary: "A person's raw punches. Requires attendance:read unless it is you." })
  @ApiOkResponse({ type: PunchResponseDto, isArray: true })
  punches(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Query() query: AttendanceRangeQueryDto) {
    return this.queryBus.execute(new ListPunchesQuery(actor, params.id, query.from, query.to));
  }
}

@ApiTags('hr-attendance')
@ApiBearerAuth()
@Controller({ path: 'hr/attendance/manual', version: '1' })
export class ManualAttendanceController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Manual attendance entries (attendance:read, :enter or :approve)' })
  @ApiOkResponse({ type: ManualAttendancePageResponseDto })
  list(@CurrentUser() actor: Actor, @Query() query: ManualAttendanceListQueryDto): Promise<Page<ManualAttendanceView>> {
    return this.queryBus.execute(new ListManualAttendanceQuery(actor, query));
  }

  @Post()
  @RequirePermissions('attendance:enter')
  @ApiOperation({ summary: 'Enter in/out times for a day (as a draft, or submitted for approval)' })
  @ApiCreatedResponse({ type: ManualAttendanceResponseDto })
  async create(@CurrentUser() actor: Actor, @Body() dto: CreateManualAttendanceDto): Promise<ManualAttendanceView> {
    const { staffId, date, inTime, outTime, reason, submit } = dto;
    const { id } = await this.commandBus.execute(
      new CreateManualAttendanceCommand(actor, staffId, date, { inTime, outTime, reason }, submit),
    );
    return this.queryBus.execute(new GetManualAttendanceQuery(actor, id));
  }

  // Declared before ':id' so the literal segment wins.
  @Get('context')
  @ApiOperation({ summary: 'Check a person and day before entering: blocking errors, warnings, resulting status' })
  @ApiOkResponse({ type: ManualContextResponseDto })
  context(@CurrentUser() actor: Actor, @Query() query: ManualContextQueryDto): Promise<ManualContextView> {
    return this.queryBus.execute(
      new GetManualAttendanceContextQuery(
        actor,
        query.staffId,
        query.date,
        { inTime: query.inTime ?? null, outTime: query.outTime ?? null },
        query.excludeId,
      ),
    );
  }

  @Get(':id')
  @ApiOkResponse({ type: ManualAttendanceResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto): Promise<ManualAttendanceView> {
    return this.queryBus.execute(new GetManualAttendanceQuery(actor, params.id));
  }

  @Patch(':id')
  @RequirePermissions('attendance:enter')
  @ApiOperation({ summary: 'Edit a draft or rejected entry' })
  @ApiOkResponse({ type: ManualAttendanceResponseDto })
  async edit(
    @CurrentUser() actor: Actor,
    @Param() params: IdParamDto,
    @Body() dto: EditManualAttendanceDto,
  ): Promise<ManualAttendanceView> {
    const { version, ...times } = dto;
    await this.commandBus.execute(
      new ActOnManualAttendanceCommand(actor, params.id, 'edit', version, undefined, times),
    );
    return this.queryBus.execute(new GetManualAttendanceQuery(actor, params.id));
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ManualAttendanceResponseDto })
  submit(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: ManualActionDto) {
    return this.act(actor, params.id, 'submit', dto);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve a pending entry (not one you entered, submitted or that is yours)' })
  @ApiOkResponse({ type: ManualAttendanceResponseDto })
  approve(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: ManualActionDto) {
    return this.act(actor, params.id, 'approve', dto);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ManualAttendanceResponseDto })
  reject(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: ManualActionDto) {
    return this.act(actor, params.id, 'reject', dto);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel an entry; cancelling an approved one revokes it and needs an approver' })
  @ApiOkResponse({ type: ManualAttendanceResponseDto })
  cancel(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: ManualActionDto) {
    return this.act(actor, params.id, 'cancel', dto);
  }

  private async act(
    actor: Actor,
    id: string,
    action: ManualAction,
    dto: ManualActionDto,
  ): Promise<ManualAttendanceView> {
    await this.commandBus.execute(new ActOnManualAttendanceCommand(actor, id, action, dto.version, dto.remarks));
    return this.queryBus.execute(new GetManualAttendanceQuery(actor, id));
  }
}
