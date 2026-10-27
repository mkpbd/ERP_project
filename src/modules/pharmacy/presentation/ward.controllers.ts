import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
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
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import { IdParamDto } from '../../../shared/presentation/zod/common.schemas.js';
import {
  CancelWardIndentCommand,
  GetWardIndentQuery,
  GetWardIssueQuery,
  IssueToWardCommand,
  ListWardIndentsQuery,
  ListWardIssuesQuery,
  RaiseWardIndentCommand,
  ReturnFromWardCommand,
} from '../application/ward.messages.js';
import { PharmacyCreatedDocumentResponseDto } from './dto/purchase.dto.js';
import {
  PharmacyWardIndentCancelDto,
  PharmacyWardIndentDto,
  PharmacyWardIndentListQueryDto,
  PharmacyWardIndentPageResponseDto,
  PharmacyWardIndentResponseDto,
  PharmacyWardIssueDto,
  PharmacyWardIssueListQueryDto,
  PharmacyWardIssuePageResponseDto,
  PharmacyWardIssueResponseDto,
  PharmacyWardIssuedResponseDto,
  PharmacyWardReturnDto,
  PharmacyWardReturnedResponseDto,
} from './dto/ward.dto.js';

/** Ward documents are seen with pharmacy:ward or pharmacy:read (checked by the handlers). */
@ApiTags('pharmacy')
@ApiBearerAuth()
@Controller({ path: 'pharmacy', version: '1' })
export class PharmacyWardController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('ward-indents')
  @ApiOkResponse({ type: PharmacyWardIndentPageResponseDto })
  indents(@CurrentUser() actor: Actor, @Query() query: PharmacyWardIndentListQueryDto) {
    return this.queryBus.execute(new ListWardIndentsQuery(actor, query));
  }

  @Get('ward-indents/:id')
  @ApiOkResponse({ type: PharmacyWardIndentResponseDto })
  indent(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetWardIndentQuery(actor, params.id));
  }

  @Post('ward-indents')
  @RequirePermissions('pharmacy:ward')
  @ApiOperation({ summary: 'A ward asks an outlet for medicine for an admitted patient (not once the bill is made)' })
  @ApiCreatedResponse({ type: PharmacyCreatedDocumentResponseDto })
  raise(@CurrentUser() actor: Actor, @Body() dto: PharmacyWardIndentDto) {
    return this.commandBus.execute(new RaiseWardIndentCommand(actor, dto));
  }

  @Post('ward-indents/:id/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel an open indent, with a reason (the ward, or the outlet it was sent to)' })
  @ApiNoContentResponse()
  async cancel(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: PharmacyWardIndentCancelDto) {
    await this.commandBus.execute(new CancelWardIndentCommand(actor, params.id, dto.version, dto.reason));
  }

  @Get('ward-issues')
  @ApiOkResponse({ type: PharmacyWardIssuePageResponseDto })
  issues(@CurrentUser() actor: Actor, @Query() query: PharmacyWardIssueListQueryDto) {
    return this.queryBus.execute(new ListWardIssuesQuery(actor, query));
  }

  @Get('ward-issues/:id')
  @ApiOkResponse({ type: PharmacyWardIssueResponseDto })
  issue(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetWardIssueQuery(actor, params.id));
  }

  @Post('ward-issues')
  @RequirePermissions('pharmacy:sell')
  @ApiOperation({
    summary: "Send medicine to a ward from an outlet you work at, charged to the admission's indoor bill",
  })
  @ApiCreatedResponse({ type: PharmacyWardIssuedResponseDto })
  issueToWard(@CurrentUser() actor: Actor, @Body() dto: PharmacyWardIssueDto) {
    return this.commandBus.execute(new IssueToWardCommand(actor, dto));
  }

  @Post('ward-issues/:id/returns')
  @RequirePermissions('pharmacy:sell')
  @ApiOperation({ summary: 'Unused medicine back from the ward before the final bill: restocked and taken off' })
  @ApiCreatedResponse({ type: PharmacyWardReturnedResponseDto })
  giveBack(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: PharmacyWardReturnDto) {
    return this.commandBus.execute(
      new ReturnFromWardCommand(actor, params.id, dto.version, dto.returnedOn, dto.lines, dto.reason),
    );
  }
}

export const WARD_CONTROLLERS = [PharmacyWardController];
