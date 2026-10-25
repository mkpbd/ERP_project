import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, StreamableFile } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Actor } from '../../../shared/application/actor.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import { IdParamDto } from '../../../shared/presentation/zod/common.schemas.js';
import {
  GetReportQuery,
  GetRoleReportsQuery,
  ListAllReportsQuery,
  ListMyReportsQuery,
  RenderReportCommand,
  SetRoleReportsCommand,
  type ReportDetailView,
  type ReportSummaryView,
  type RoleReportsView,
} from '../application/reporting.messages.js';
import {
  RenderReportDto,
  ReportDetailResponseDto,
  ReportKeyParamDto,
  ReportSummaryResponseDto,
  RoleReportsResponseDto,
  SetRoleReportsDto,
} from './dto/reporting.dto.js';

@ApiTags('reports')
@ApiBearerAuth()
@Controller({ path: 'reports', version: '1' })
export class ReportsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Reports you can run, by group' })
  @ApiOkResponse({ type: ReportSummaryResponseDto, isArray: true })
  mine(@CurrentUser() actor: Actor): Promise<ReportSummaryView[]> {
    return this.queryBus.execute(new ListMyReportsQuery(actor));
  }

  // Declared before ':key' so the literal segment wins.
  @Get('catalog')
  @RequirePermissions('reports:read')
  @ApiOperation({ summary: 'Every report the system defines (for granting them to roles)' })
  @ApiOkResponse({ type: ReportSummaryResponseDto, isArray: true })
  catalog(@CurrentUser() actor: Actor): Promise<ReportSummaryView[]> {
    return this.queryBus.execute(new ListAllReportsQuery(actor));
  }

  @Get(':key')
  @ApiOperation({ summary: 'A report you can run, with the JSON Schema of its parameters' })
  @ApiOkResponse({ type: ReportDetailResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: ReportKeyParamDto): Promise<ReportDetailView> {
    return this.queryBus.execute(new GetReportQuery(actor, params.key));
  }

  @Post(':key/render')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run a report and download it as PDF or Excel. Every run is audited.' })
  @ApiProduces('application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async render(
    @CurrentUser() actor: Actor,
    @Param() params: ReportKeyParamDto,
    @Body() dto: RenderReportDto,
  ): Promise<StreamableFile> {
    const file = await this.commandBus.execute(new RenderReportCommand(actor, params.key, dto.format, dto.params));
    return new StreamableFile(file.data, {
      type: file.contentType,
      disposition: `attachment; filename="${file.fileName}"`,
      length: file.data.length,
    });
  }
}

@ApiTags('roles')
@ApiBearerAuth()
@Controller({ path: 'roles', version: '1' })
export class RoleReportsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get(':id/reports')
  @RequirePermissions('reports:read')
  @ApiOkResponse({ type: RoleReportsResponseDto })
  reports(@CurrentUser() actor: Actor, @Param() params: IdParamDto): Promise<RoleReportsView> {
    return this.queryBus.execute(new GetRoleReportsQuery(actor, params.id));
  }

  @Put(':id/reports')
  @RequirePermissions('reports:assign')
  @ApiOperation({
    summary: "Replace a role's reports. Without reports:access-all you can only add or remove reports you can run.",
  })
  @ApiOkResponse({ type: RoleReportsResponseDto })
  setReports(
    @CurrentUser() actor: Actor,
    @Param() params: IdParamDto,
    @Body() dto: SetRoleReportsDto,
  ): Promise<RoleReportsView> {
    return this.commandBus.execute(new SetRoleReportsCommand(actor, params.id, dto.reportKeys));
  }
}
