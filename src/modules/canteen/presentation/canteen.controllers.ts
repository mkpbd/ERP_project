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
import { createRecordController } from '../../../shared/presentation/record-controller.js';
import {
  IdParamDto,
  pageMetaShape,
  paginationShape,
  recordResponseShape,
  responseDto,
  updateSchema,
} from '../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../shared/presentation/zod/zod-dto.js';
import {
  CancelSaleCommand,
  CANTEEN_RECORDS,
  CollectDueCommand,
  GetSaleQuery,
  ListSalesQuery,
  MemberStatementQuery,
  OutletUsersQuery,
  SellCommand,
  SetOutletUsersCommand,
} from '../application/canteen.messages.js';
import { CUSTOMER_KINDS } from '../domain/sale.js';

const amount = z.number().min(0).max(10_000_000).multipleOf(0.01);
const filterShape = (extra: z.ZodRawShape = {}) =>
  z.object({
    q: z.string().trim().min(1).max(100).optional(),
    isActive: z.enum(['true', 'false']).optional(),
    ...extra,
  });

const groupFields = { name: z.string().trim().min(1).max(60), isActive: z.boolean() };
class CanteenCreateGroupDto extends createZodDto(
  z.strictObject({ ...groupFields, isActive: z.boolean().default(true) }),
) {}
class CanteenUpdateGroupDto extends createZodDto(updateSchema(groupFields)) {}
class CanteenGroupFilterDto extends createZodDto(filterShape()) {}
class CanteenGroupResponseDto extends responseDto(recordResponseShape(groupFields)) {}

const itemFields = {
  code: z.string().trim().min(1).max(20).nullable(),
  name: z.string().trim().min(1).max(100),
  groupId: z.uuid(),
  unit: z.string().trim().min(1).max(20),
  rate: amount,
  staffRate: amount,
  vatPercent: z.number().min(0).max(100).multipleOf(0.01),
  /** A store item of the supply chain, used up from the outlet's store department when sold. */
  stockVariantId: z.uuid().nullable(),
  stockQty: z.number().positive().max(1000).multipleOf(0.001),
  isActive: z.boolean(),
};
class CanteenCreateItemDto extends createZodDto(
  z.strictObject({
    ...itemFields,
    code: itemFields.code.default(null),
    vatPercent: itemFields.vatPercent.default(0),
    stockVariantId: itemFields.stockVariantId.default(null),
    stockQty: itemFields.stockQty.default(1),
    isActive: z.boolean().default(true),
  }),
) {}
class CanteenUpdateItemDto extends createZodDto(updateSchema(itemFields)) {}
class CanteenItemFilterDto extends createZodDto(filterShape({ groupId: z.uuid().optional() })) {}
class CanteenItemResponseDto extends responseDto(recordResponseShape(itemFields)) {}

const outletFields = {
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).nullable(),
  /** The supply chain's store department its packaged goods are used up from. */
  storeDepartmentId: z.uuid().nullable(),
  isActive: z.boolean(),
};
class CanteenCreateOutletDto extends createZodDto(
  z.strictObject({
    ...outletFields,
    description: outletFields.description.default(null),
    storeDepartmentId: outletFields.storeDepartmentId.default(null),
    isActive: z.boolean().default(true),
  }),
) {}
class CanteenUpdateOutletDto extends createZodDto(updateSchema(outletFields)) {}
class CanteenOutletFilterDto extends createZodDto(filterShape()) {}
class CanteenOutletResponseDto extends responseDto(recordResponseShape(outletFields)) {}

const memberFields = {
  name: z.string().trim().min(1).max(150),
  mobileNo: z.string().regex(/^01[3-9]\d{8}$/),
  address: z.string().trim().max(300).nullable(),
  reference: z.string().trim().max(150).nullable(),
  isActive: z.boolean(),
};
class CanteenCreateMemberDto extends createZodDto(
  z.strictObject({
    ...memberFields,
    address: memberFields.address.default(null),
    reference: memberFields.reference.default(null),
    isActive: z.boolean().default(true),
  }),
) {}
class CanteenUpdateMemberDto extends createZodDto(updateSchema(memberFields)) {}
class CanteenMemberFilterDto extends createZodDto(filterShape()) {}
class CanteenMemberResponseDto extends responseDto(recordResponseShape(memberFields)) {}

const access = { tag: 'canteen', readPermission: 'canteen:read', managePermission: 'canteen:manage' } as const;
export const CanteenGroupsController = createRecordController({
  ...access,
  className: 'CanteenGroupsController',
  path: 'canteen/groups',
  type: CANTEEN_RECORDS.group,
  label: 'canteen group',
  create: CanteenCreateGroupDto,
  update: CanteenUpdateGroupDto,
  response: CanteenGroupResponseDto,
  filter: CanteenGroupFilterDto,
});
/** Old Canteen.Item: the menu, at general and staff rates, with VAT. */
export const CanteenItemsController = createRecordController({
  ...access,
  className: 'CanteenItemsController',
  path: 'canteen/items',
  type: CANTEEN_RECORDS.item,
  label: 'canteen item',
  create: CanteenCreateItemDto,
  update: CanteenUpdateItemDto,
  response: CanteenItemResponseDto,
  filter: CanteenItemFilterDto,
});
export const CanteenOutletsController = createRecordController({
  ...access,
  className: 'CanteenOutletsController',
  path: 'canteen/outlets',
  type: CANTEEN_RECORDS.outlet,
  label: 'canteen outlet',
  create: CanteenCreateOutletDto,
  update: CanteenUpdateOutletDto,
  response: CanteenOutletResponseDto,
  filter: CanteenOutletFilterDto,
});
/** Old LoyalMember: regular customers who may eat on credit. */
export const CanteenMembersController = createRecordController({
  ...access,
  className: 'CanteenMembersController',
  path: 'canteen/members',
  type: CANTEEN_RECORDS.member,
  label: 'canteen member',
  create: CanteenCreateMemberDto,
  update: CanteenUpdateMemberDto,
  response: CanteenMemberResponseDto,
  filter: CanteenMemberFilterDto,
});

class CanteenSaleDto extends createZodDto(
  z.strictObject({
    outletId: z.uuid(),
    customerKind: z.enum(CUSTOMER_KINDS).default('walk_in'),
    staffId: z.uuid().nullable().default(null),
    memberId: z.uuid().nullable().default(null),
    customerName: z.string().trim().max(150).nullable().default(null),
    lines: z
      .array(z.strictObject({ itemId: z.uuid(), qty: z.number().positive().max(1000) }))
      .min(1)
      .max(50),
    discount: amount.default(0),
    paid: amount,
  }),
) {}
class CanteenCancelDto extends createZodDto(z.strictObject({ version: z.int().min(1), reason: z.string().max(300) })) {}
class CanteenCollectDto extends createZodDto(
  z.strictObject({ amount: amount.min(0.01), note: z.string().trim().max(300).nullable().default(null) }),
) {}
class CanteenOutletUsersDto extends createZodDto(z.strictObject({ userIds: z.array(z.uuid()).max(50) })) {}
class CanteenSaleListQueryDto extends createZodDto(
  z.object({
    ...paginationShape,
    outletId: z.uuid().optional(),
    memberId: z.uuid().optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    status: z.enum(['billed', 'cancelled']).optional(),
  }),
) {}

const saleShape = {
  id: z.uuid(),
  number: z.string(),
  outletId: z.uuid(),
  outletName: z.string(),
  soldOn: z.string(),
  soldAt: z.date(),
  customerKind: z.enum(CUSTOMER_KINDS),
  staffId: z.uuid().nullable(),
  memberId: z.uuid().nullable(),
  customerName: z.string().nullable(),
  gross: z.number(),
  discount: z.number(),
  vat: z.number(),
  net: z.number(),
  paid: z.number(),
  due: z.number(),
  status: z.enum(['billed', 'cancelled']),
  cancelReason: z.string().nullable(),
  consumptionNumber: z.string().nullable(),
  stockShort: z.boolean(),
  voucherNumber: z.string().nullable(),
  soldBy: z.uuid().nullable(),
  cancelledBy: z.uuid().nullable(),
  cancelledAt: z.date().nullable(),
  version: z.int(),
};
class CanteenSoldResponseDto extends responseDto({
  id: z.uuid(),
  number: z.string(),
  net: z.number(),
  due: z.number(),
  change: z.number(),
  stock: z.enum(['none', 'used', 'short']),
}) {}
class CanteenCollectedResponseDto extends responseDto({ id: z.uuid(), number: z.string(), balance: z.number() }) {}
class CanteenSalePageResponseDto extends responseDto({ items: z.array(z.object(saleShape)), ...pageMetaShape }) {}
class CanteenSaleResponseDto extends responseDto({
  ...saleShape,
  memberName: z.string().nullable(),
  lines: z.array(
    z.object({
      itemId: z.uuid(),
      itemName: z.string(),
      unit: z.string(),
      qty: z.number(),
      rate: z.number(),
      amount: z.number(),
      vat: z.number(),
    }),
  ),
}) {}
class CanteenStatementResponseDto extends responseDto({
  member: z.object({ id: z.uuid(), name: z.string(), mobileNo: z.string() }),
  entries: z.array(
    z.object({
      on: z.string(),
      number: z.string(),
      kind: z.enum(['sale', 'collection']),
      debit: z.number(),
      credit: z.number(),
      balance: z.number(),
    }),
  ),
  balance: z.number(),
}) {}
class CanteenOutletUsersResponseDto extends responseDto({ userIds: z.array(z.uuid()) }) {}

@ApiTags('canteen')
@ApiBearerAuth()
@Controller({ path: 'canteen', version: '1' })
export class CanteenController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('outlets/:id/users')
  @RequirePermissions('canteen:read')
  @ApiOkResponse({ type: CanteenOutletUsersResponseDto })
  async outletUsers(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return { userIds: await this.queryBus.execute(new OutletUsersQuery(actor, params.id)) };
  }

  @Put('outlets/:id/users')
  @RequirePermissions('canteen:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Who sells at the outlet (the whole list)' })
  @ApiNoContentResponse()
  async setOutletUsers(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: CanteenOutletUsersDto) {
    await this.commandBus.execute(new SetOutletUsersCommand(actor, params.id, dto.userIds));
  }

  @Get('sales')
  @RequirePermissions('canteen:read')
  @ApiOkResponse({ type: CanteenSalePageResponseDto })
  sales(@CurrentUser() actor: Actor, @Query() query: CanteenSaleListQueryDto) {
    return this.queryBus.execute(new ListSalesQuery(actor, query));
  }

  @Get('sales/:id')
  @RequirePermissions('canteen:read')
  @ApiOkResponse({ type: CanteenSaleResponseDto })
  sale(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetSaleQuery(actor, params.id));
  }

  @Post('sales')
  @RequirePermissions('canteen:sell')
  @ApiOperation({
    summary: 'A sale at an outlet you sell at: walk-in, staff (staff rates) or member (may leave a due)',
  })
  @ApiCreatedResponse({ type: CanteenSoldResponseDto })
  sell(@CurrentUser() actor: Actor, @Body() dto: CanteenSaleDto) {
    return this.commandBus.execute(new SellCommand(actor, dto));
  }

  @Post('sales/:id/cancel')
  @RequirePermissions('canteen:sell')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "The day's sale by its seller; another day's by canteen:manage" })
  @ApiNoContentResponse()
  async cancel(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: CanteenCancelDto) {
    await this.commandBus.execute(new CancelSaleCommand(actor, params.id, dto.version, dto.reason));
  }

  @Get('members/:id/statement')
  @RequirePermissions('canteen:read')
  @ApiOkResponse({ type: CanteenStatementResponseDto })
  statement(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new MemberStatementQuery(actor, params.id));
  }

  @Post('members/:id/collections')
  @RequirePermissions('canteen:sell')
  @ApiOperation({ summary: 'Money a member pays against their dues (never more than they owe)' })
  @ApiCreatedResponse({ type: CanteenCollectedResponseDto })
  collect(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: CanteenCollectDto) {
    return this.commandBus.execute(new CollectDueCommand(actor, params.id, dto.amount, dto.note));
  }
}

export const CANTEEN_CONTROLLERS = [
  CanteenGroupsController,
  CanteenItemsController,
  CanteenOutletsController,
  CanteenMembersController,
  CanteenController,
];
