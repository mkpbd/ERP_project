import { Body, Controller, Get, HttpCode, HttpStatus, Put, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor } from '../../../shared/application/actor.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import { createRecordController } from '../../../shared/presentation/record-controller.js';
import { DUTY_EXCHANGE, EXTRA_DUTY, SHIFT_TYPE } from '../application/hr.constants.js';
import {
  GetMyRosterQuery,
  GetRosterMonthQuery,
  SaveRosterEntriesCommand,
  type RosterDayView,
  type RosterEntryResult,
  type RosterMonthView,
} from '../application/roster.messages.js';
import {
  CreateDutyExchangeDto,
  CreateExtraDutyDto,
  CreateShiftTypeDto,
  DateRangeQueryDto,
  DutyExchangeResponseDto,
  ExtraDutyResponseDto,
  RosterDayResponseDto,
  RosterMonthQueryDto,
  RosterMonthResponseDto,
  SaveRosterDto,
  SaveRosterResponseDto,
  ShiftTypeFilterDto,
  ShiftTypeResponseDto,
  StaffPeriodFilterDto,
  UpdateDutyExchangeDto,
  UpdateExtraDutyDto,
  UpdateShiftTypeDto,
} from './dto/roster.dto.js';

const roster = { tag: 'hr-roster', managePermission: 'roster:manage' } as const;

export const ShiftTypesController = createRecordController({
  ...roster,
  className: 'ShiftTypesController',
  path: 'hr/roster/shift-types',
  type: SHIFT_TYPE,
  label: 'shift type',
  create: CreateShiftTypeDto,
  update: UpdateShiftTypeDto,
  response: ShiftTypeResponseDto,
  filter: ShiftTypeFilterDto,
});

export const DutyExchangesController = createRecordController({
  ...roster,
  className: 'DutyExchangesController',
  path: 'hr/roster/duty-exchanges',
  type: DUTY_EXCHANGE,
  label: 'duty exchange',
  create: CreateDutyExchangeDto,
  update: UpdateDutyExchangeDto,
  response: DutyExchangeResponseDto,
  filter: StaffPeriodFilterDto,
});

export const ExtraDutiesController = createRecordController({
  ...roster,
  className: 'ExtraDutiesController',
  path: 'hr/roster/extra-duties',
  type: EXTRA_DUTY,
  label: 'extra duty',
  create: CreateExtraDutyDto,
  update: UpdateExtraDutyDto,
  response: ExtraDutyResponseDto,
  filter: StaffPeriodFilterDto,
});

@ApiTags('hr-roster')
@ApiBearerAuth()
@Controller({ path: 'hr/roster', version: '1' })
export class RosterController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('month')
  @ApiOperation({
    summary: "A sub-department's roster for a month: staff, shift types, filled cells, government holidays",
  })
  @ApiOkResponse({ type: RosterMonthResponseDto })
  month(@CurrentUser() actor: Actor, @Query() query: RosterMonthQueryDto): Promise<RosterMonthView> {
    return this.queryBus.execute(new GetRosterMonthQuery(actor, query));
  }

  @Put('entries')
  @RequirePermissions('roster:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Save roster cells. Each cell is checked on its own (version, rules) and reported as saved, unchanged, invalid or conflict; valid cells are saved together.',
  })
  @ApiOkResponse({ type: SaveRosterResponseDto })
  save(
    @CurrentUser() actor: Actor,
    @Body() dto: SaveRosterDto,
  ): Promise<{ results: RosterEntryResult[]; saved: number; failed: number }> {
    const { entries, ...month } = dto;
    return this.commandBus.execute(new SaveRosterEntriesCommand(actor, month, entries));
  }

  @Get('me')
  @ApiOperation({ summary: 'Your own duties and days off in a date range (at most 93 days)' })
  @ApiOkResponse({ type: RosterDayResponseDto, isArray: true })
  mine(@CurrentUser() actor: Actor, @Query() query: DateRangeQueryDto): Promise<RosterDayView[]> {
    return this.queryBus.execute(new GetMyRosterQuery(actor, query.from, query.to));
  }
}
