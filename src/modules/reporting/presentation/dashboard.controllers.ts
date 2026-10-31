import { Controller, Get, Param, Query } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Actor } from '../../../shared/application/actor.js';
import { CurrentUser } from '../../../shared/presentation/auth.decorators.js';
import { responseDto } from '../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../shared/presentation/zod/zod-dto.js';
import {
  GetDashboardBreakdownQuery,
  GetDashboardQuery,
  type DashboardBreakdownView,
  type DashboardView,
} from '../application/dashboard.handlers.js';

const day = z.iso.date();
const unit = z.enum(['money', 'count']);
const dimension = z.object({ key: z.string(), label: z.string() });

class DashboardQueryDto extends createZodDto(z.object({ from: day.optional(), to: day.optional() })) {}
class DashboardBreakdownQueryDto extends createZodDto(
  z.object({ from: day.optional(), to: day.optional(), by: z.string().trim().min(1).max(40).optional() }),
) {}
class DashboardHeadParamDto extends createZodDto(
  z.strictObject({ key: z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/) }),
) {}
class DashboardResponseDto extends responseDto({
  from: z.string(),
  to: z.string(),
  previousFrom: z.string(),
  previousTo: z.string(),
  sections: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      heads: z.array(
        z.object({
          key: z.string(),
          label: z.string(),
          unit,
          hint: z.string().nullable(),
          current: z.boolean(),
          value: z.number(),
          previous: z.number().nullable(),
          dimensions: z.array(dimension),
        }),
      ),
    }),
  ),
}) {}
class DashboardBreakdownResponseDto extends responseDto({
  key: z.string(),
  label: z.string(),
  unit,
  dimension: z.string(),
  rows: z.array(z.object({ label: z.string(), value: z.number() })),
}) {}

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller({ path: 'dashboard', version: '1' })
export class DashboardController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get()
  @ApiOperation({
    summary:
      'The sections you may see (by their permissions) with each figure over the days asked (today by default) and the days before; money needs dashboard:finance',
  })
  @ApiOkResponse({ type: DashboardResponseDto })
  get(@CurrentUser() actor: Actor, @Query() query: DashboardQueryDto): Promise<DashboardView> {
    return this.queryBus.execute(new GetDashboardQuery(actor, query.from, query.to));
  }

  @Get('heads/:key')
  @ApiOperation({ summary: 'One figure split by one of its dimensions (by day when none is given)' })
  @ApiOkResponse({ type: DashboardBreakdownResponseDto })
  breakdown(
    @CurrentUser() actor: Actor,
    @Param() params: DashboardHeadParamDto,
    @Query() query: DashboardBreakdownQueryDto,
  ): Promise<DashboardBreakdownView> {
    return this.queryBus.execute(new GetDashboardBreakdownQuery(actor, params.key, query.from, query.to, query.by));
  }
}
