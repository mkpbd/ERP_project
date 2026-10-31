import { Body, Controller, Get, HttpCode, HttpStatus, Param, Put, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Actor } from '../../../shared/application/actor.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import { responseDto } from '../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../shared/presentation/zod/zod-dto.js';
import { GetBudgetQuery, MAX_BUDGET_LINES, SetBudgetCommand } from '../application/budget.js';

class FiscalYearParamDto extends createZodDto(z.object({ fiscalYearId: z.uuid() })) {}
class BudgetQueryDto extends createZodDto(z.object({ to: z.iso.date().optional() })) {}
class SetBudgetDto extends createZodDto(
  z.strictObject({
    lines: z
      .array(
        z.strictObject({
          glAccountId: z.uuid(),
          amount: z.number().min(0).max(100_000_000_000).multipleOf(0.01),
          note: z.string().trim().max(300).nullable().default(null),
        }),
      )
      .max(MAX_BUDGET_LINES),
  }),
) {}
const totals = z.object({ budget: z.number(), actual: z.number() });
class BudgetResponseDto extends responseDto({
  fiscalYear: z.object({
    id: z.uuid(),
    label: z.string(),
    startsOn: z.string(),
    endsOn: z.string(),
    isClosed: z.boolean(),
  }),
  to: z.string(),
  lines: z.array(
    z.object({
      glAccountId: z.uuid(),
      code: z.string(),
      name: z.string(),
      nature: z.string(),
      side: z.enum(['income', 'expense']),
      budgeted: z.boolean(),
      budget: z.number(),
      actual: z.number(),
      variance: z.number(),
      usedPercent: z.number().nullable(),
      note: z.string().nullable(),
    }),
  ),
  income: totals,
  expense: totals,
  profit: totals,
}) {}

/** Old Budget Settings (step 15g): each income and expense account's budget for a fiscal year, against actual. */
@ApiTags('accounts-books')
@ApiBearerAuth()
@Controller({ path: 'accounts', version: '1' })
export class BudgetsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('budgets/:fiscalYearId')
  @RequirePermissions('accounts:read')
  @ApiOperation({ summary: "The year's budget against what was posted from its start to a date (its end by default)" })
  @ApiOkResponse({ type: BudgetResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: FiscalYearParamDto, @Query() query: BudgetQueryDto) {
    return this.queryBus.execute(new GetBudgetQuery(actor, params.fiscalYearId, query.to ?? null));
  }

  @Put('budgets/:fiscalYearId')
  @RequirePermissions('accounts:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "The year's whole budget, account by account (income and expense accounts only)" })
  @ApiNoContentResponse()
  async set(@CurrentUser() actor: Actor, @Param() params: FiscalYearParamDto, @Body() dto: SetBudgetDto) {
    await this.commandBus.execute(new SetBudgetCommand(actor, params.fiscalYearId, dto.lines));
  }
}
