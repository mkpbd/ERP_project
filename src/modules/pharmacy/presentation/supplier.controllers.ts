import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor } from '../../../shared/application/actor.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import { IdParamDto } from '../../../shared/presentation/zod/common.schemas.js';
import {
  CloseSupplierReturnCommand,
  CreateSupplierReturnCommand,
  DeleteSupplierReturnCommand,
  EditSupplierReturnCommand,
  GetPaymentQuery,
  GetSupplierDuesQuery,
  GetSupplierReturnQuery,
  ListPaymentsQuery,
  ListSupplierReturnsQuery,
  PaySupplierCommand,
  SendSupplierReturnCommand,
  SettleSupplierReturnCommand,
} from '../application/supplier.messages.js';
import { PharmacyCreatedDocumentResponseDto, PharmacyVersionDto, PharmacyVersionQueryDto } from './dto/purchase.dto.js';
import {
  PharmacyCloseReturnDto,
  PharmacyCreateReturnDto,
  PharmacyDuesQueryDto,
  PharmacyDuesResponseDto,
  PharmacyEditReturnDto,
  PharmacyPaidResponseDto,
  PharmacyPayDto,
  PharmacyPaymentListQueryDto,
  PharmacyPaymentPageResponseDto,
  PharmacyPaymentResponseDto,
  PharmacyReturnListQueryDto,
  PharmacyReturnPageResponseDto,
  PharmacyReturnResponseDto,
  PharmacySentResponseDto,
  PharmacySettledResponseDto,
  PharmacySettleReturnDto,
} from './dto/supplier.dto.js';

@ApiTags('pharmacy')
@ApiBearerAuth()
@Controller({ path: 'pharmacy', version: '1' })
export class PharmacyPaymentsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('supplier-dues')
  @RequirePermissions('pharmacy:read')
  @ApiOperation({ summary: "A supplier's posted receives with something still due" })
  @ApiOkResponse({ type: PharmacyDuesResponseDto })
  async dues(@CurrentUser() actor: Actor, @Query() query: PharmacyDuesQueryDto) {
    return { items: await this.queryBus.execute(new GetSupplierDuesQuery(actor, query.supplierId)) };
  }

  @Get('supplier-payments')
  @RequirePermissions('pharmacy:read')
  @ApiOkResponse({ type: PharmacyPaymentPageResponseDto })
  list(@CurrentUser() actor: Actor, @Query() query: PharmacyPaymentListQueryDto) {
    return this.queryBus.execute(new ListPaymentsQuery(actor, query));
  }

  @Get('supplier-payments/:id')
  @RequirePermissions('pharmacy:read')
  @ApiOkResponse({ type: PharmacyPaymentResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetPaymentQuery(actor, params.id));
  }

  @Post('supplier-payments')
  @RequirePermissions('pharmacy:payment')
  @ApiOperation({ summary: 'Pay a supplier for one or more posted receives, in cash or from a bank account' })
  @ApiCreatedResponse({ type: PharmacyPaidResponseDto })
  pay(@CurrentUser() actor: Actor, @Body() dto: PharmacyPayDto) {
    return this.commandBus.execute(
      new PaySupplierCommand(
        actor,
        dto.supplierId,
        dto.paidOn,
        dto.method,
        dto.bankAccountId,
        dto.reference,
        dto.remarks,
        dto.lines,
      ),
    );
  }
}

@ApiTags('pharmacy')
@ApiBearerAuth()
@Controller({ path: 'pharmacy/supplier-returns', version: '1' })
export class PharmacySupplierReturnsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @RequirePermissions('pharmacy:read')
  @ApiOkResponse({ type: PharmacyReturnPageResponseDto })
  list(@CurrentUser() actor: Actor, @Query() query: PharmacyReturnListQueryDto) {
    return this.queryBus.execute(new ListSupplierReturnsQuery(actor, query));
  }

  @Get(':id')
  @RequirePermissions('pharmacy:read')
  @ApiOkResponse({ type: PharmacyReturnResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetSupplierReturnQuery(actor, params.id));
  }

  @Post()
  @RequirePermissions('pharmacy:receive')
  @ApiOperation({ summary: 'Draft a return of lots to a supplier from an outlet you work at' })
  @ApiCreatedResponse({ type: PharmacyCreatedDocumentResponseDto })
  create(@CurrentUser() actor: Actor, @Body() dto: PharmacyCreateReturnDto) {
    return this.commandBus.execute(
      new CreateSupplierReturnCommand(actor, dto.outletId, dto.supplierId, dto.returnDate, dto.reason, dto.lines),
    );
  }

  @Patch(':id')
  @RequirePermissions('pharmacy:receive')
  @HttpCode(HttpStatus.NO_CONTENT)
  async edit(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: PharmacyEditReturnDto) {
    const { version, ...changes } = dto;
    await this.commandBus.execute(new EditSupplierReturnCommand(actor, params.id, version, changes));
  }

  @Delete(':id')
  @RequirePermissions('pharmacy:receive')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Query() query: PharmacyVersionQueryDto) {
    await this.commandBus.execute(new DeleteSupplierReturnCommand(actor, params.id, query.version));
  }

  @Post(':id/send')
  @RequirePermissions('pharmacy:receive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Take the lots out of stock and charge their cost to the supplier' })
  @ApiOkResponse({ type: PharmacySentResponseDto })
  send(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: PharmacyVersionDto) {
    return this.commandBus.execute(new SendSupplierReturnCommand(actor, params.id, dto.version));
  }

  @Post(':id/settle')
  @RequirePermissions('pharmacy:receive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive replacement goods against the return (up to its value)' })
  @ApiOkResponse({ type: PharmacySettledResponseDto })
  settle(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: PharmacySettleReturnDto) {
    return this.commandBus.execute(new SettleSupplierReturnCommand(actor, params.id, dto.version, dto.on, dto.lines));
  }

  @Post(':id/close')
  @RequirePermissions('pharmacy:receive')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Close the return; what is not replaced stays on the supplier ledger' })
  async close(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: PharmacyCloseReturnDto) {
    await this.commandBus.execute(new CloseSupplierReturnCommand(actor, params.id, dto.version, dto.reason));
  }
}

export const SUPPLIER_CONTROLLERS = [PharmacyPaymentsController, PharmacySupplierReturnsController];
