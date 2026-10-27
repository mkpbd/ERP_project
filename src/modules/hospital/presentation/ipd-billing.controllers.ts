import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
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
import {
  IdParamDto,
  pageMetaShape,
  paginationShape,
  responseDto,
} from '../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../shared/presentation/zod/zod-dto.js';
import {
  AddIpdChargeCommand,
  CancelIpdBillCommand,
  CancelIpdChargeCommand,
  CollectIpdDueCommand,
  GetIpdAccountQuery,
  GetIpdBillQuery,
  GetIpdPolicyQuery,
  ListIpdBillsQuery,
  MakeIpdBillCommand,
  MoveIpdAdvanceCommand,
  SetIpdPolicyCommand,
} from '../application/ipd-billing.messages.js';
import { PAYMENT_METHODS } from '../domain/opd-bill.js';

const version = z.int().min(1);
const day = z.iso.date();
const money = z.number().min(0).max(10_000_000).multipleOf(0.01);
const percent = z.number().min(0).max(100).multipleOf(0.01);
const reason = z.string().trim().min(1).max(300);
const HEADS = ['admission', 'bed', 'round', 'service', 'medicine'] as const;
const PAYMENT_KINDS = ['advance', 'refund', 'payment', 'collection'] as const;

const moneyShape = {
  amount: money,
  method: z.enum(PAYMENT_METHODS).default('cash'),
  reference: z.string().trim().max(100).nullable().default(null),
};

const policyShape = { roundFeePerNight: money, serviceChargePercent: percent, counterDiscountPercent: percent };
class IpdPolicyDto extends createZodDto(z.strictObject(policyShape)) {}
class IpdPolicyResponseDto extends responseDto(policyShape) {}

class ChargeDto extends createZodDto(
  z.strictObject({
    serviceId: z.uuid(),
    /** The doctor who gave it: a consultant's visit, a procedure; needed when the service carries a share. */
    doctorId: z.uuid().nullable().default(null),
    qty: z.int().min(1).max(1000).default(1),
    /** Left out: today. */
    chargedOn: day.nullable().default(null),
    note: z.string().trim().max(200).nullable().default(null),
  }),
) {}
class ChargeParamDto extends createZodDto(z.object({ id: z.uuid(), chargeId: z.uuid() })) {}
class ReasonDto extends createZodDto(z.strictObject({ reason })) {}
class MoneyDto extends createZodDto(z.strictObject(moneyShape)) {}
class FinalBillDto extends createZodDto(
  z.strictObject({
    /** Null: the corporate client's own discount, if any. */
    discount: money.nullable().default(null),
    discountReason: z.string().trim().max(200).nullable().default(null),
    payment: z.strictObject(moneyShape).nullable().default(null),
  }),
) {}
class CancelIpdBillDto extends createZodDto(z.strictObject({ version, reason })) {}
class CollectIpdDueDto extends createZodDto(z.strictObject({ version, ...moneyShape })) {}
class IpdBillListQueryDto extends createZodDto(
  z.object({
    ...paginationShape,
    patientId: z.uuid().optional(),
    from: day.optional(),
    to: day.optional(),
    status: z.enum(['billed', 'cancelled']).optional(),
    withDue: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    corporateClientId: z.uuid().optional(),
  }),
) {}

const lineShape = {
  head: z.enum(HEADS),
  description: z.string(),
  doctorId: z.uuid().nullable(),
  doctorName: z.string().nullable(),
  fromOn: z.string().nullable(),
  toOn: z.string().nullable(),
  qty: z.int(),
  rate: z.number(),
  amount: z.number(),
  serviceCharge: z.number(),
  shareAmount: z.number(),
};
const paymentShape = {
  number: z.string(),
  kind: z.enum(PAYMENT_KINDS),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().nullable(),
  amount: z.number(),
  paidOn: z.string(),
  billNumber: z.string().nullable(),
};
const summaryShape = {
  id: z.uuid(),
  number: z.string(),
  billedOn: z.string(),
  admissionId: z.uuid(),
  admissionNumber: z.string(),
  patientId: z.uuid(),
  uhid: z.int(),
  patientName: z.string(),
  net: z.number(),
  deposit: z.number(),
  paid: z.number(),
  collected: z.number(),
  due: z.number(),
  status: z.enum(['billed', 'cancelled']),
  corporateClientId: z.uuid().nullable(),
  corporateClientName: z.string().nullable(),
  staffId: z.uuid().nullable(),
  version: z.int(),
};
class ChargedResponseDto extends responseDto({ id: z.uuid(), amount: z.number() }) {}
class AdvanceResponseDto extends responseDto({ number: z.string(), held: z.number() }) {}
class BilledResponseDto extends responseDto({
  id: z.uuid(),
  number: z.string(),
  net: z.number(),
  due: z.number(),
  receipt: z.string().nullable(),
}) {}
class BillCancelledResponseDto extends responseDto({ held: z.number() }) {}
class IpdCollectedResponseDto extends responseDto({ number: z.string(), due: z.number() }) {}
class IpdBillPageResponseDto extends responseDto({ items: z.array(z.object(summaryShape)), ...pageMetaShape }) {}
class IpdBillResponseDto extends responseDto({
  ...summaryShape,
  nights: z.int(),
  gross: z.number(),
  serviceCharge: z.number(),
  discount: z.number(),
  discountReason: z.string().nullable(),
  cancelReason: z.string().nullable(),
  cancelledOn: z.string().nullable(),
  voucherNumber: z.string().nullable(),
  cancelVoucherNumber: z.string().nullable(),
  billedBy: z.uuid().nullable(),
  createdAt: z.date(),
  lines: z.array(z.object(lineShape)),
}) {}
class IpdAccountResponseDto extends responseDto({
  admissionId: z.uuid(),
  admissionNumber: z.string(),
  admissionStatus: z.enum(['admitted', 'discharged', 'cancelled']),
  asOf: z.string(),
  nights: z.int(),
  lines: z.array(z.object(lineShape)),
  gross: z.number(),
  serviceCharge: z.number(),
  total: z.number(),
  held: z.number(),
  balance: z.number(),
  bill: z
    .object({
      id: z.uuid(),
      number: z.string(),
      billedOn: z.string(),
      discount: z.number(),
      net: z.number(),
      deposit: z.number(),
      paid: z.number(),
      collected: z.number(),
      due: z.number(),
      version: z.int(),
    })
    .nullable(),
  charges: z.array(
    z.object({
      id: z.uuid(),
      serviceId: z.uuid(),
      serviceName: z.string(),
      doctorId: z.uuid().nullable(),
      doctorName: z.string().nullable(),
      chargedOn: z.string(),
      qty: z.int(),
      rate: z.number(),
      amount: z.number(),
      note: z.string().nullable(),
      status: z.enum(['active', 'cancelled']),
      cancelReason: z.string().nullable(),
    }),
  ),
  payments: z.array(z.object(paymentShape)),
  openIndents: z.int(),
}) {}

@ApiTags('ipd')
@ApiBearerAuth()
@Controller({ path: 'hospital', version: '1' })
export class IpdBillingController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('ipd-policy')
  @RequirePermissions('ipd:read')
  @ApiOkResponse({ type: IpdPolicyResponseDto })
  policy(@CurrentUser() actor: Actor) {
    return this.queryBus.execute(new GetIpdPolicyQuery(actor));
  }

  @Put('ipd-policy')
  @RequirePermissions('ipd:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'The round fee per bed night, the service charge and the counter discount limit' })
  @ApiNoContentResponse()
  async setPolicy(@CurrentUser() actor: Actor, @Body() dto: IpdPolicyDto) {
    await this.commandBus.execute(new SetIpdPolicyCommand(actor, dto));
  }

  @Get('admissions/:id/account')
  @RequirePermissions('ipd:read')
  @ApiOperation({ summary: 'The bill in force, or what it would be today, with the charges and the money in and out' })
  @ApiOkResponse({ type: IpdAccountResponseDto })
  account(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetIpdAccountQuery(actor, params.id));
  }

  @Post('admissions/:id/charges')
  @RequirePermissions('ipd:bill')
  @ApiOperation({ summary: "A service or a consultant's visit given on a day of the stay, at the service's rate" })
  @ApiCreatedResponse({ type: ChargedResponseDto })
  charge(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: ChargeDto) {
    return this.commandBus.execute(new AddIpdChargeCommand(actor, params.id, dto));
  }

  @Post('admissions/:id/charges/:chargeId/cancel')
  @RequirePermissions('ipd:bill')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Take a charge off before the final bill, with a reason' })
  @ApiNoContentResponse()
  async cancelCharge(@CurrentUser() actor: Actor, @Param() params: ChargeParamDto, @Body() dto: ReasonDto) {
    await this.commandBus.execute(new CancelIpdChargeCommand(actor, params.id, params.chargeId, dto.reason));
  }

  @Post('admissions/:id/advances')
  @RequirePermissions('ipd:bill')
  @ApiOperation({ summary: 'An advance taken while the patient is in, before the final bill' })
  @ApiCreatedResponse({ type: AdvanceResponseDto })
  advance(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: MoneyDto) {
    return this.commandBus.execute(new MoveIpdAdvanceCommand(actor, params.id, 'advance', dto));
  }

  @Post('admissions/:id/refunds')
  @RequirePermissions('ipd:bill')
  @ApiOperation({ summary: 'Advance held given back (before the final bill)' })
  @ApiCreatedResponse({ type: AdvanceResponseDto })
  refund(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: MoneyDto) {
    return this.commandBus.execute(new MoveIpdAdvanceCommand(actor, params.id, 'refund', dto));
  }

  @Post('admissions/:id/final-bill')
  @RequirePermissions('ipd:bill')
  @ApiOperation({
    summary: 'The final bill to today: the advance held is taken against it, the rest paid or owed (posted at once)',
  })
  @ApiCreatedResponse({ type: BilledResponseDto })
  bill(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: FinalBillDto) {
    return this.commandBus.execute(new MakeIpdBillCommand(actor, params.id, dto));
  }

  @Get('ipd-bills')
  @RequirePermissions('ipd:read')
  @ApiOkResponse({ type: IpdBillPageResponseDto })
  list(@CurrentUser() actor: Actor, @Query() query: IpdBillListQueryDto) {
    return this.queryBus.execute(new ListIpdBillsQuery(actor, query));
  }

  @Get('ipd-bills/:id')
  @RequirePermissions('ipd:read')
  @ApiOkResponse({ type: IpdBillResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetIpdBillQuery(actor, params.id));
  }

  @Post('ipd-bills/:id/cancel')
  @RequirePermissions('ipd:bill')
  @ApiOperation({
    summary: 'Cancel a final bill while the patient is in (later than its day: ipd:manage); the money is held again',
  })
  @ApiOkResponse({ type: BillCancelledResponseDto })
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: CancelIpdBillDto) {
    return this.commandBus.execute(new CancelIpdBillCommand(actor, params.id, dto.version, dto.reason));
  }

  @Post('ipd-bills/:id/collections')
  @RequirePermissions('ipd:bill')
  @ApiOperation({ summary: 'A due collected against a final bill, with its receipt' })
  @ApiCreatedResponse({ type: IpdCollectedResponseDto })
  collect(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: CollectIpdDueDto) {
    const { version: billVersion, ...money } = dto;
    return this.commandBus.execute(new CollectIpdDueCommand(actor, params.id, billVersion, money));
  }
}

export const IPD_BILLING_CONTROLLERS = [IpdBillingController];
