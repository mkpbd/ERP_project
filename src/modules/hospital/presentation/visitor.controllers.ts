import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import type { Actor } from '../../../shared/application/actor.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import { IdParamDto, responseDto } from '../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../shared/presentation/zod/zod-dto.js';
import {
  IssueVisitorPassCommand,
  ListVisitorPassesQuery,
  ReturnVisitorPassCommand,
} from '../application/visitor.messages.js';

class IssuePassDto extends createZodDto(
  z.strictObject({
    visitorName: z.string().trim().min(1).max(150),
    relation: z.string().trim().max(50).nullable().default(null),
    mobileNo: z.string().trim().max(20).nullable().default(null),
  }),
) {}
const passShape = {
  id: z.uuid(),
  number: z.string(),
  admissionId: z.uuid(),
  visitorName: z.string(),
  relation: z.string().nullable(),
  mobileNo: z.string().nullable(),
  status: z.enum(['active', 'returned']),
  issuedAt: z.date(),
  issuedByName: z.string().nullable(),
  returnedAt: z.date().nullable(),
  returnedByName: z.string().nullable(),
  valid: z.boolean(),
};
class PassIssuedResponseDto extends responseDto({ id: z.uuid(), number: z.string() }) {}
class PassListResponseDto extends responseDto({ items: z.array(z.object(passShape)) }) {}

/**
 * Old Visiting Card (step 15c): passes for an admitted patient's attendants, up to the IPD policy's limit in force at
 * once. Printed with the report hospital.visitor-pass.
 */
@ApiTags('ipd')
@ApiBearerAuth()
@Controller({ path: 'hospital', version: '1' })
export class VisitorPassesController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('admissions/:id/visitor-passes')
  @RequirePermissions('ipd:read')
  @ApiOkResponse({ type: PassListResponseDto })
  async list(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return { items: await this.queryBus.execute(new ListVisitorPassesQuery(actor, params.id)) };
  }

  @Post('admissions/:id/visitor-passes')
  @RequirePermissions('ipd:admit')
  @ApiOperation({ summary: "A pass for an attendant of an admitted patient, within the policy's limit" })
  @ApiCreatedResponse({ type: PassIssuedResponseDto })
  issue(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: IssuePassDto) {
    return this.commandBus.execute(new IssueVisitorPassCommand(actor, params.id, dto));
  }

  @Post('visitor-passes/:id/return')
  @RequirePermissions('ipd:admit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'A pass handed back (lost, or the attendant changed)' })
  @ApiNoContentResponse()
  async handBack(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    await this.commandBus.execute(new ReturnVisitorPassCommand(actor, params.id));
  }
}
