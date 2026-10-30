import { Controller, Get, Param, Query } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Actor } from '../../../shared/application/actor.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import { IdParamDto, responseDto } from '../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../shared/presentation/zod/zod-dto.js';
import {
  GetHistoryRecordQuery,
  HISTORY_KINDS,
  LabTrendQuery,
  ListHistoryQuery,
} from '../application/history.messages.js';

class HistoryPatientParamDto extends createZodDto(z.object({ patientId: z.uuid() })) {}
class HistoryListQueryDto extends createZodDto(z.object({ kind: z.enum(HISTORY_KINDS).optional() })) {}
class HistoryTrendQueryDto extends createZodDto(z.object({ test: z.string().trim().min(1).max(200) })) {}

const entryShape = {
  id: z.uuid(),
  kind: z.enum(HISTORY_KINDS),
  title: z.string(),
  number: z.string().nullable(),
  recordedOn: z.string(),
  author: z.string().nullable(),
  shared: z.boolean(),
};
class HistoryListResponseDto extends responseDto({ items: z.array(z.object(entryShape)) }) {}
class HistoryRecordResponseDto extends responseDto({
  ...entryShape,
  patientId: z.uuid(),
  body: z.string(),
  values: z.array(
    z.object({ test: z.string(), result: z.string(), unit: z.string().nullable(), reference: z.string().nullable() }),
  ),
}) {}
class HistoryTrendResponseDto extends responseDto({
  items: z.array(
    z.object({
      recordId: z.uuid(),
      recordedOn: z.string(),
      number: z.string().nullable(),
      result: z.string(),
      value: z.number().nullable(),
      unit: z.string().nullable(),
      reference: z.string().nullable(),
    }),
  ),
}) {}

/** The old system's clinical records of a patient, brought over at the cut-over (step 13f). Read only. */
@ApiTags('clinical')
@ApiBearerAuth()
@Controller({ path: 'clinical', version: '1' })
export class HistoryController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get('patients/:patientId/history')
  @RequirePermissions('emr:read')
  @ApiOperation({ summary: "The patient's records from the old system, newest first" })
  @ApiOkResponse({ type: HistoryListResponseDto })
  async list(
    @CurrentUser() actor: Actor,
    @Param() params: HistoryPatientParamDto,
    @Query() query: HistoryListQueryDto,
  ) {
    return { items: await this.queryBus.execute(new ListHistoryQuery(actor, params.patientId, query.kind)) };
  }

  @Get('patients/:patientId/history/trend')
  @RequirePermissions('emr:read')
  @ApiOperation({ summary: "The patient's old results of one test, oldest first" })
  @ApiOkResponse({ type: HistoryTrendResponseDto })
  async trend(
    @CurrentUser() actor: Actor,
    @Param() params: HistoryPatientParamDto,
    @Query() query: HistoryTrendQueryDto,
  ) {
    return { items: await this.queryBus.execute(new LabTrendQuery(actor, params.patientId, query.test)) };
  }

  @Get('history/:id')
  @RequirePermissions('emr:read')
  @ApiOperation({ summary: 'One record from the old system, with its results' })
  @ApiOkResponse({ type: HistoryRecordResponseDto })
  record(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetHistoryRecordQuery(actor, params.id));
  }
}
