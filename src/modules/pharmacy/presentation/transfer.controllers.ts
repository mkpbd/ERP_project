import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor } from '../../../shared/application/actor.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import { IdParamDto } from '../../../shared/presentation/zod/common.schemas.js';
import {
  DecideTransferCommand,
  EditIndentCommand,
  EndIndentCommand,
  GetIndentQuery,
  GetTransferQuery,
  ListIndentsQuery,
  ListTransfersQuery,
  RaiseIndentCommand,
  SendTransferCommand,
} from '../application/transfer.messages.js';
import { PharmacyCreatedDocumentResponseDto } from './dto/purchase.dto.js';
import {
  PharmacyDecideTransferDto,
  PharmacyEditIndentDto,
  PharmacyEndIndentDto,
  PharmacyIndentListQueryDto,
  PharmacyIndentPageResponseDto,
  PharmacyIndentResponseDto,
  PharmacyRaiseIndentDto,
  PharmacySendTransferDto,
  PharmacyTransferListQueryDto,
  PharmacyTransferPageResponseDto,
  PharmacyTransferResponseDto,
} from './dto/transfer.dto.js';

@ApiTags('pharmacy')
@ApiBearerAuth()
@Controller({ path: 'pharmacy/outlet-indents', version: '1' })
export class PharmacyIndentsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @RequirePermissions('pharmacy:read')
  @ApiOkResponse({ type: PharmacyIndentPageResponseDto })
  list(@CurrentUser() actor: Actor, @Query() query: PharmacyIndentListQueryDto) {
    return this.queryBus.execute(new ListIndentsQuery(actor, query));
  }

  @Get(':id')
  @RequirePermissions('pharmacy:read')
  @ApiOperation({ summary: 'An indent with what was sent so far and what the supplying outlet holds' })
  @ApiOkResponse({ type: PharmacyIndentResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetIndentQuery(actor, params.id));
  }

  @Post()
  @RequirePermissions('pharmacy:transfer')
  @ApiOperation({ summary: 'Ask another outlet for stock, from an outlet you work at' })
  @ApiCreatedResponse({ type: PharmacyCreatedDocumentResponseDto })
  raise(@CurrentUser() actor: Actor, @Body() dto: PharmacyRaiseIndentDto) {
    return this.commandBus.execute(
      new RaiseIndentCommand(
        actor,
        dto.requestingOutletId,
        dto.supplyingOutletId,
        dto.indentDate,
        dto.urgent,
        dto.note,
        dto.lines,
      ),
    );
  }

  @Patch(':id')
  @RequirePermissions('pharmacy:transfer')
  @HttpCode(HttpStatus.NO_CONTENT)
  async edit(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: PharmacyEditIndentDto) {
    const { version, ...changes } = dto;
    await this.commandBus.execute(new EditIndentCommand(actor, params.id, version, changes));
  }

  @Post(':id/cancel')
  @RequirePermissions('pharmacy:transfer')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cancel(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: PharmacyEndIndentDto) {
    await this.commandBus.execute(new EndIndentCommand(actor, params.id, dto.version, 'cancel', dto.reason));
  }

  @Post(':id/close')
  @RequirePermissions('pharmacy:transfer')
  @HttpCode(HttpStatus.NO_CONTENT)
  async close(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: PharmacyEndIndentDto) {
    await this.commandBus.execute(new EndIndentCommand(actor, params.id, dto.version, 'close', dto.reason));
  }
}

@ApiTags('pharmacy')
@ApiBearerAuth()
@Controller({ path: 'pharmacy/transfers', version: '1' })
export class PharmacyTransfersController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @RequirePermissions('pharmacy:read')
  @ApiOkResponse({ type: PharmacyTransferPageResponseDto })
  list(@CurrentUser() actor: Actor, @Query() query: PharmacyTransferListQueryDto) {
    return this.queryBus.execute(new ListTransfersQuery(actor, query));
  }

  @Get(':id')
  @RequirePermissions('pharmacy:read')
  @ApiOkResponse({ type: PharmacyTransferResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetTransferQuery(actor, params.id));
  }

  @Post()
  @RequirePermissions('pharmacy:transfer')
  @ApiOperation({ summary: 'Send stock to another outlet (against an indent or not), first expiring first' })
  @ApiCreatedResponse({ type: PharmacyCreatedDocumentResponseDto })
  send(@CurrentUser() actor: Actor, @Body() dto: PharmacySendTransferDto) {
    return this.commandBus.execute(
      new SendTransferCommand(
        actor,
        dto.fromOutletId,
        dto.toOutletId,
        dto.indentId,
        dto.transferDate,
        dto.note,
        dto.lines,
      ),
    );
  }

  @Post(':id/decision')
  @RequirePermissions('pharmacy:transfer')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Accept the stock at the receiving outlet, or reject it back to the sender' })
  async decide(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: PharmacyDecideTransferDto) {
    await this.commandBus.execute(
      new DecideTransferCommand(actor, params.id, dto.version, dto.decision, dto.on, dto.reason),
    );
  }
}

export const TRANSFER_CONTROLLERS = [PharmacyIndentsController, PharmacyTransfersController];
