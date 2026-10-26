import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
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
  AssetInboxQuery,
  DecideAssetDocumentCommand,
  GetAssetDocumentQuery,
  ListAssetDocumentsQuery,
  OpenDiscardCommand,
  OpenScrapSaleCommand,
  OpenServiceCommand,
  ReceiveServiceCommand,
  SellDiscardCommand,
  type AssetDocumentKind,
} from '../application/asset-request.handlers.js';
import { CreatedDocumentResponseDto } from './dto/purchase.dto.js';

const day = z.iso.date();
const ref = z.uuid();
const version = z.int().min(1);
const text = (max: number) => z.string().trim().max(max).nullable();

class ListQueryDto extends createZodDto(
  z.object({ ...paginationShape, status: z.string().trim().max(30).optional() }),
) {}
class OpenServiceDto extends createZodDto(
  z.strictObject({
    requestDate: day,
    sentTo: z.string().trim().min(1).max(200),
    supplierId: ref.nullable().default(null),
    note: text(1000).default(null),
    lines: z
      .array(
        z.strictObject({
          assetId: ref,
          serviceType: z.enum(['warranty', 'maintenance']),
          problem: text(500).default(null),
          cost: z.number().min(0).max(1_000_000_000).default(0),
        }),
      )
      .min(1)
      .max(300),
  }),
) {}
class OpenDiscardDto extends createZodDto(
  z.strictObject({
    requestDate: day,
    reason: z.string().trim().min(1).max(500),
    lines: z
      .array(z.strictObject({ assetId: ref, reason: text(500).default(null) }))
      .min(1)
      .max(300),
  }),
) {}
class OpenScrapSaleDto extends createZodDto(
  z.strictObject({
    saleDate: day,
    buyer: z.string().trim().min(1).max(200),
    buyerSupplierId: ref.nullable().default(null),
    lines: z
      .array(
        z.strictObject({
          description: z.string().trim().min(1).max(300),
          unit: text(30).default(null),
          qty: z.number().positive().max(1_000_000_000),
          unitPrice: z.number().min(0).max(1_000_000_000),
        }),
      )
      .min(1)
      .max(300),
  }),
) {}
class DecideDto extends createZodDto(
  z.strictObject({
    version,
    decision: z.enum(['approve', 'reject']),
    remarks: text(500).default(null),
    rejectAssets: z.array(ref).max(300).default([]),
    on: day,
  }),
) {}
class ReceiveDto extends createZodDto(
  z.strictObject({
    version,
    assetIds: z.array(ref).min(1).max(300),
    costs: z
      .array(z.strictObject({ assetId: ref, cost: z.number().min(0).max(1_000_000_000) }))
      .max(300)
      .default([]),
    on: day,
  }),
) {}
class SellDto extends createZodDto(
  z.strictObject({
    version,
    soldTo: z.string().trim().min(1).max(200),
    buyerSupplierId: ref.nullable().default(null),
    on: day,
    amounts: z.array(z.strictObject({ assetId: ref, amount: z.number().min(0).max(1_000_000_000) })).max(300),
  }),
) {}

const summaryShape = {
  id: z.uuid(),
  number: z.string(),
  date: z.string(),
  status: z.string(),
  currentLevel: z.int().nullable(),
  currentLevelName: z.string().nullable(),
  party: z.string().nullable(),
  version: z.int(),
};
class PageResponseDto extends responseDto({ items: z.array(z.object(summaryShape)), ...pageMetaShape }) {}
class InboxResponseDto extends responseDto({ items: z.array(z.object(summaryShape)) }) {}
class AssetDocumentResponseDto extends responseDto({
  ...summaryShape,
  kind: z.string(),
  fields: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
  lines: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))),
  decisions: z.array(
    z.object({
      stage: z.enum(['request', 'sale']),
      levelOrder: z.int(),
      levelName: z.string(),
      decision: z.string(),
      decidedBy: z.uuid().nullable(),
      decidedAt: z.date(),
      remarks: z.string().nullable(),
    }),
  ),
}) {}
class DecisionResponseDto extends responseDto({ status: z.string(), reference: z.string().nullable() }) {}
class SaleProposedResponseDto extends responseDto({ status: z.string() }) {}

/** List, detail, inbox and decision of one kind of asset document. */
abstract class AssetDocuments {
  protected abstract readonly kind: AssetDocumentKind;

  constructor(
    protected readonly commandBus: CommandBus,
    protected readonly queryBus: QueryBus,
  ) {}

  @Get()
  @RequirePermissions('scm:read')
  @ApiOkResponse({ type: PageResponseDto })
  list(@CurrentUser() actor: Actor, @Query() query: ListQueryDto) {
    return this.queryBus.execute(new ListAssetDocumentsQuery(actor, this.kind, query));
  }

  @Get('inbox')
  @ApiOperation({ summary: 'Pending documents waiting for one of your roles' })
  @ApiOkResponse({ type: InboxResponseDto })
  async inbox(@CurrentUser() actor: Actor) {
    return { items: await this.queryBus.execute(new AssetInboxQuery(actor, this.kind)) };
  }

  @Get(':id')
  @RequirePermissions('scm:read')
  @ApiOkResponse({ type: AssetDocumentResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetAssetDocumentQuery(actor, this.kind, params.id));
  }

  @Post(':id/decision')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve (dropping pieces if needed) or reject at the current level (of the sale, when one is pending)',
  })
  @ApiOkResponse({ type: DecisionResponseDto })
  decide(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: DecideDto) {
    return this.commandBus.execute(
      new DecideAssetDocumentCommand(
        actor,
        this.kind,
        params.id,
        dto.version,
        dto.decision,
        dto.remarks,
        dto.rejectAssets,
        dto.on,
      ),
    );
  }
}

@ApiTags('supply-chain')
@ApiBearerAuth()
@Controller({ path: 'scm/asset-service-requests', version: '1' })
export class AssetServiceRequestsController extends AssetDocuments {
  protected readonly kind = 'service';

  constructor(commandBus: CommandBus, queryBus: QueryBus) {
    super(commandBus, queryBus);
  }

  @Post()
  @RequirePermissions('scm:assets')
  @ApiOperation({ summary: 'Ask to send pieces out for warranty repair or maintenance' })
  @ApiCreatedResponse({ type: CreatedDocumentResponseDto })
  open(@CurrentUser() actor: Actor, @Body() dto: OpenServiceDto) {
    return this.commandBus.execute(
      new OpenServiceCommand(actor, dto.requestDate, dto.sentTo, dto.supplierId, dto.note, dto.lines),
    );
  }

  @Post(':id/receive')
  @RequirePermissions('scm:assets')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Pieces back from service into stock, with what the maintenance cost' })
  async receive(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: ReceiveDto) {
    await this.commandBus.execute(
      new ReceiveServiceCommand(
        actor,
        params.id,
        dto.version,
        dto.assetIds,
        new Map(dto.costs.map((line) => [line.assetId, line.cost])),
        dto.on,
      ),
    );
  }
}

@ApiTags('supply-chain')
@ApiBearerAuth()
@Controller({ path: 'scm/asset-discard-requests', version: '1' })
export class AssetDiscardRequestsController extends AssetDocuments {
  protected readonly kind = 'discard';

  constructor(commandBus: CommandBus, queryBus: QueryBus) {
    super(commandBus, queryBus);
  }

  @Post()
  @RequirePermissions('scm:assets')
  @ApiOperation({ summary: 'Ask to write pieces off' })
  @ApiCreatedResponse({ type: CreatedDocumentResponseDto })
  open(@CurrentUser() actor: Actor, @Body() dto: OpenDiscardDto) {
    return this.commandBus.execute(new OpenDiscardCommand(actor, dto.requestDate, dto.reason, dto.lines));
  }

  @Post(':id/sell')
  @RequirePermissions('scm:assets')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Propose the sale of the written-off pieces, for approval on the discard_sale ladder' })
  @ApiOkResponse({ type: SaleProposedResponseDto })
  sell(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: SellDto) {
    return this.commandBus.execute(
      new SellDiscardCommand(
        actor,
        params.id,
        dto.version,
        dto.soldTo,
        dto.buyerSupplierId,
        dto.on,
        new Map(dto.amounts.map((line) => [line.assetId, line.amount])),
      ),
    );
  }
}

@ApiTags('supply-chain')
@ApiBearerAuth()
@Controller({ path: 'scm/scrap-sales', version: '1' })
export class ScrapSalesController extends AssetDocuments {
  protected readonly kind = 'scrap_sale';

  constructor(commandBus: CommandBus, queryBus: QueryBus) {
    super(commandBus, queryBus);
  }

  @Post()
  @RequirePermissions('scm:assets')
  @ApiOperation({ summary: 'Raise a sale of scrap that is not a registered asset' })
  @ApiCreatedResponse({ type: CreatedDocumentResponseDto })
  open(@CurrentUser() actor: Actor, @Body() dto: OpenScrapSaleDto) {
    return this.commandBus.execute(
      new OpenScrapSaleCommand(actor, dto.saleDate, dto.buyer, dto.buyerSupplierId, dto.lines),
    );
  }
}

export const ASSET_REQUEST_CONTROLLERS = [
  AssetServiceRequestsController,
  AssetDiscardRequestsController,
  ScrapSalesController,
];
