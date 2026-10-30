import { Controller, Get, Param } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Actor } from '../../../shared/application/actor.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import { IdParamDto, responseDto } from '../../../shared/presentation/zod/common.schemas.js';
import { GetMigrationRunQuery, ListMigrationRunsQuery } from '../application/migration.queries.js';

const runShape = {
  id: z.uuid(),
  startedAt: z.date(),
  finishedAt: z.date().nullable(),
  dryRun: z.boolean(),
  loaders: z.array(z.string()),
  status: z.enum(['running', 'done', 'failed']),
  written: z.int(),
  rejected: z.int(),
  error: z.string().nullable(),
};
class MigrationRunListResponseDto extends responseDto({ items: z.array(z.object(runShape)) }) {}
class MigrationRunResponseDto extends responseDto({ ...runShape, report: z.unknown() }) {}

/** The runs of the data migration from the old system (step 13), read-only; the tool itself runs from the CLI. */
@ApiTags('data-migration')
@ApiBearerAuth()
@Controller({ path: 'data-migration', version: '1' })
export class MigrationController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get('runs')
  @RequirePermissions('migration:read')
  @ApiOperation({ summary: 'The data migration runs and reconciliations, newest first' })
  @ApiOkResponse({ type: MigrationRunListResponseDto })
  async runs(@CurrentUser() actor: Actor) {
    return { items: await this.queryBus.execute(new ListMigrationRunsQuery(actor)) };
  }

  @Get('runs/:id')
  @RequirePermissions('migration:read')
  @ApiOperation({ summary: "A run with each loader's counts and notes, or a reconciliation's checks" })
  @ApiOkResponse({ type: MigrationRunResponseDto })
  run(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetMigrationRunQuery(actor, params.id));
  }
}
