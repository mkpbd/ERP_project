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
  CancelOpdBillCommand,
  CollectCorporateDueCommand,
  CollectOpdDueCommand,
  CreateOpdBillCommand,
  GetOpdBillQuery,
  GetOpdPolicyQuery,
  ListOpdBillsQuery,
  SetOpdPolicyCommand,
  SuggestVisitQuery,
} from '../application/opd.messages.js';
import { VISIT_TYPES } from '../domain/appointment.js';
import { PAYMENT_METHODS } from '../domain/opd-bill.js';

const day = z.iso.date();
const version = z.int().min(1);
const money = z.number().min(0).max(10_000_000).multipleOf(0.01);
const percent = z.number().min(0).max(100).multipleOf(0.01);

const policyShape = {
  followUpDays: z.int().min(0).max(365),
  defaultSharePercent: percent,
  counterDiscountPercent: percent,
};
class OpdPolicyDto extends createZodDto(z.strictObject(policyShape)) {}
class OpdPolicyResponseDto extends responseDto(policyShape) {}

class CreateOpdBillDto extends createZodDto(
  z.strictObject({
    patientId: z.uuid(),
    appointmentId: z.uuid().nullable().default(null),
    referredById: z.uuid().nullable().default(null),
    lines: z
      .array(
        z.strictObject({
          /** A consultation's doctor, or the doctor who gave a service. */
          doctorId: z.uuid().nullable().default(null),
          visitType: z.enum(VISIT_TYPES).nullable().default(null),
          /** Set for a service. */
          serviceId: z.uuid().nullable().default(null),
          qty: z.int().min(1).max(1000).default(1),
        }),
      )
      .min(1)
      .max(10),
    corporateClientId: z.uuid().nullable().default(null),
    staffId: z.uuid().nullable().default(null),
    discount: money.nullable().default(null),
    discountReason: z.string().trim().max(200).nullable().default(null),
    payment: z
      .strictObject({
        method: z.enum(PAYMENT_METHODS).default('cash'),
        reference: z.string().trim().max(100).nullable().default(null),
        amount: money,
      })
      .nullable()
      .default(null),
  }),
) {}
class CollectOpdDueDto extends createZodDto(
  z.strictObject({
    version,
    amount: money,
    method: z.enum(PAYMENT_METHODS).default('cash'),
    reference: z.string().trim().max(100).nullable().default(null),
  }),
) {}
class CancelOpdBillDto extends createZodDto(z.strictObject({ version, reason: z.string().trim().min(1).max(300) })) {}
class OpdBillListQueryDto extends createZodDto(
  z.object({
    ...paginationShape,
    patientId: z.uuid().optional(),
    doctorId: z.uuid().optional(),
    from: day.optional(),
    to: day.optional(),
    status: z.enum(['billed', 'cancelled']).optional(),
    withDue: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    corporateClientId: z.uuid().optional(),
    staffId: z.uuid().optional(),
  }),
) {}
class CollectCorporateDueDto extends createZodDto(
  z.strictObject({
    amount: money,
    method: z.enum(PAYMENT_METHODS).default('cash'),
    reference: z.string().trim().max(100).nullable().default(null),
  }),
) {}
class CorporateCollectedResponseDto extends responseDto({
  number: z.string(),
  settled: z.array(z.object({ billId: z.uuid(), number: z.string(), amount: z.number() })),
}) {}
class SuggestVisitQueryDto extends createZodDto(z.object({ patientId: z.uuid(), doctorId: z.uuid() })) {}

const summaryShape = {
  id: z.uuid(),
  number: z.string(),
  billedOn: z.string(),
  patientId: z.uuid(),
  uhid: z.int(),
  patientName: z.string(),
  gross: z.number(),
  discount: z.number(),
  net: z.number(),
  paid: z.number(),
  collected: z.number(),
  due: z.number(),
  status: z.enum(['billed', 'cancelled']),
  corporateClientId: z.uuid().nullable(),
  corporateClientName: z.string().nullable(),
  staffId: z.uuid().nullable(),
  version: z.int(),
};
class OpdBillCreatedResponseDto extends responseDto({
  id: z.uuid(),
  number: z.string(),
  net: z.number(),
  due: z.number(),
}) {}
class OpdCollectedResponseDto extends responseDto({ number: z.string() }) {}
class OpdCancelledResponseDto extends responseDto({ refunded: z.number() }) {}
class SuggestedVisitResponseDto extends responseDto({
  visitType: z.enum(VISIT_TYPES),
  lastVisitOn: z.string().nullable(),
  fee: z.number(),
}) {}
class OpdBillPageResponseDto extends responseDto({ items: z.array(z.object(summaryShape)), ...pageMetaShape }) {}
class OpdBillResponseDto extends responseDto({
  ...summaryShape,
  appointmentId: z.uuid().nullable(),
  mobileNo: z.string().nullable(),
  sex: z.string(),
  dateOfBirth: z.string(),
  referredById: z.uuid().nullable(),
  referredByName: z.string().nullable(),
  discountReason: z.string().nullable(),
  cancelReason: z.string().nullable(),
  cancelledOn: z.string().nullable(),
  refunded: z.number(),
  voucherNumber: z.string().nullable(),
  cancelVoucherNumber: z.string().nullable(),
  billedBy: z.uuid().nullable(),
  createdAt: z.date(),
  lines: z.array(
    z.object({
      line: z.int(),
      doctorId: z.uuid().nullable(),
      doctorName: z.string().nullable(),
      roomNo: z.string().nullable(),
      visitType: z.enum(VISIT_TYPES).nullable(),
      serviceId: z.uuid().nullable(),
      serviceName: z.string().nullable(),
      qty: z.int(),
      rate: z.number(),
      fee: z.number(),
      sharePercent: z.number(),
      shareAmount: z.number(),
    }),
  ),
  payments: z.array(
    z.object({
      kind: z.enum(['payment', 'collection', 'refund']),
      number: z.string().nullable(),
      method: z.enum(PAYMENT_METHODS),
      reference: z.string().nullable(),
      amount: z.number(),
      paidOn: z.string(),
      receivedBy: z.uuid().nullable(),
    }),
  ),
}) {}

@ApiTags('opd')
@ApiBearerAuth()
@Controller({ path: 'hospital', version: '1' })
export class OpdBillsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('opd-policy')
  @RequirePermissions('opd:read')
  @ApiOkResponse({ type: OpdPolicyResponseDto })
  policy(@CurrentUser() actor: Actor) {
    return this.queryBus.execute(new GetOpdPolicyQuery(actor));
  }

  @Put('opd-policy')
  @RequirePermissions('opd:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Follow-up days, the default doctor share and the counter discount limit' })
  @ApiNoContentResponse()
  async setPolicy(@CurrentUser() actor: Actor, @Body() dto: OpdPolicyDto) {
    await this.commandBus.execute(new SetOpdPolicyCommand(actor, dto));
  }

  @Get('opd-bills/visit-suggestion')
  @RequirePermissions('opd:read')
  @ApiOperation({ summary: 'The visit type (follow-up within the policy days, else new) and fee for a doctor today' })
  @ApiOkResponse({ type: SuggestedVisitResponseDto })
  suggest(@CurrentUser() actor: Actor, @Query() query: SuggestVisitQueryDto) {
    return this.queryBus.execute(new SuggestVisitQuery(actor, query.patientId, query.doctorId));
  }

  @Get('opd-bills')
  @RequirePermissions('opd:read')
  @ApiOkResponse({ type: OpdBillPageResponseDto })
  list(@CurrentUser() actor: Actor, @Query() query: OpdBillListQueryDto) {
    return this.queryBus.execute(new ListOpdBillsQuery(actor, query));
  }

  @Get('opd-bills/:id')
  @RequirePermissions('opd:read')
  @ApiOkResponse({ type: OpdBillResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetOpdBillQuery(actor, params.id));
  }

  @Post('opd-bills')
  @RequirePermissions('opd:bill')
  @ApiOperation({
    summary: 'Bill consultations for a registered patient (from an appointment or a walk-in) and post the voucher',
  })
  @ApiCreatedResponse({ type: OpdBillCreatedResponseDto })
  create(@CurrentUser() actor: Actor, @Body() dto: CreateOpdBillDto) {
    return this.commandBus.execute(new CreateOpdBillCommand(actor, dto));
  }

  @Post('opd-bills/:id/collections')
  @RequirePermissions('opd:bill')
  @ApiOperation({ summary: 'Collect what is still due on a bill' })
  @ApiCreatedResponse({ type: OpdCollectedResponseDto })
  collect(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: CollectOpdDueDto) {
    return this.commandBus.execute(
      new CollectOpdDueCommand(actor, params.id, dto.version, dto.amount, dto.method, dto.reference),
    );
  }

  @Post('corporate-clients/:id/collections')
  @RequirePermissions('opd:bill')
  @ApiOperation({ summary: "A corporate client's payment, settling its bills oldest first on one receipt" })
  @ApiCreatedResponse({ type: CorporateCollectedResponseDto })
  collectCorporate(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: CollectCorporateDueDto) {
    return this.commandBus.execute(
      new CollectCorporateDueCommand(actor, params.id, dto.amount, dto.method, dto.reference),
    );
  }

  @Post('opd-bills/:id/cancel')
  @RequirePermissions('opd:bill')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a bill (its own day; later needs opd:manage): money back, doctor shares back' })
  @ApiOkResponse({ type: OpdCancelledResponseDto })
  cancel(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: CancelOpdBillDto) {
    return this.commandBus.execute(new CancelOpdBillCommand(actor, params.id, dto.version, dto.reason));
  }
}

export const OPD_CONTROLLERS = [OpdBillsController];
