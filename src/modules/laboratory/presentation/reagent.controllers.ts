import { Body, Controller, Get, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Actor } from '../../../shared/application/actor.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import { responseDto } from '../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../shared/presentation/zod/zod-dto.js';
import {
  GetStockDepartmentsQuery,
  GetTestReagentsQuery,
  SetStockDepartmentsCommand,
  SetTestReagentsCommand,
} from '../application/reagent.handlers.js';

const qty = z.number().min(0.001).max(1_000_000).multipleOf(0.001);

class ReagentTestParamDto extends createZodDto(z.object({ testId: z.uuid() })) {}
class TestReagentsDto extends createZodDto(
  z.strictObject({ reagents: z.array(z.strictObject({ variantId: z.uuid(), qty })).max(30) }),
) {}
class TestReagentsResponseDto extends responseDto({
  items: z.array(
    z.object({ variantId: z.uuid(), name: z.string().nullable(), unit: z.string().nullable(), qty: z.number() }),
  ),
}) {}
class StockDepartmentsDto extends createZodDto(
  z.strictObject({
    departments: z.array(z.strictObject({ diagnosticDepartmentId: z.uuid(), storeDepartmentId: z.uuid() })).max(50),
  }),
) {}
class StockDepartmentsResponseDto extends responseDto({
  items: z.array(
    z.object({
      diagnosticDepartmentId: z.uuid(),
      diagnosticDepartmentName: z.string().nullable(),
      storeDepartmentId: z.uuid(),
      storeDepartmentName: z.string().nullable(),
    }),
  ),
}) {}

@ApiTags('laboratory')
@ApiBearerAuth()
@Controller({ path: 'lab', version: '1' })
export class ReagentController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('tests/:testId/reagents')
  @RequirePermissions('lab:read')
  @ApiOkResponse({ type: TestReagentsResponseDto })
  async reagents(@CurrentUser() actor: Actor, @Param() params: ReagentTestParamDto) {
    return { items: await this.queryBus.execute(new GetTestReagentsQuery(actor, params.testId)) };
  }

  @Put('tests/:testId/reagents')
  @RequirePermissions('lab:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'What one test uses up (store items and quantities), the whole list' })
  @ApiNoContentResponse()
  async setReagents(@CurrentUser() actor: Actor, @Param() params: ReagentTestParamDto, @Body() dto: TestReagentsDto) {
    await this.commandBus.execute(new SetTestReagentsCommand(actor, params.testId, dto.reagents));
  }

  @Get('stock-departments')
  @RequirePermissions('lab:read')
  @ApiOkResponse({ type: StockDepartmentsResponseDto })
  async stockDepartments(@CurrentUser() actor: Actor) {
    return { items: await this.queryBus.execute(new GetStockDepartmentsQuery(actor)) };
  }

  @Put('stock-departments')
  @RequirePermissions('lab:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Which store department each diagnostic department's tests use up stock from" })
  @ApiNoContentResponse()
  async setStockDepartments(@CurrentUser() actor: Actor, @Body() dto: StockDepartmentsDto) {
    await this.commandBus.execute(new SetStockDepartmentsCommand(actor, dto.departments));
  }
}
