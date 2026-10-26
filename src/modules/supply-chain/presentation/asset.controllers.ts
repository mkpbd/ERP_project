import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page } from '../../../shared/application/pagination.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import { IdParamDto } from '../../../shared/presentation/zod/common.schemas.js';
import {
  ConfigureDepreciationCommand,
  DescribeAssetCommand,
  GetAssetQuery,
  GetRunQuery,
  ListAssetsQuery,
  ListRunsQuery,
  PostDepreciationCommand,
  PreviewDepreciationQuery,
  ReverseDepreciationCommand,
  type AssetSummary,
  type AssetView,
  type RunPreview,
  type RunSummary,
} from '../application/asset.handlers.js';
import {
  AsOfQueryDto,
  AssetListQueryDto,
  AssetPageResponseDto,
  AssetResponseDto,
  ConfigureDepreciationDto,
  ConfiguredResponseDto,
  DescribeAssetDto,
  PostedRunResponseDto,
  PostRunDto,
  ReversedRunResponseDto,
  ReverseRunDto,
  RunListQueryDto,
  RunPageResponseDto,
  RunPreviewResponseDto,
  RunResponseDto,
} from './dto/asset.dto.js';

@ApiTags('supply-chain')
@ApiBearerAuth()
@Controller({ path: 'scm/fixed-assets', version: '1' })
export class FixedAssetsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @RequirePermissions('scm:read')
  @ApiOperation({ summary: 'The asset register: every piece of a fixed-asset item, where it is and its book value' })
  @ApiOkResponse({ type: AssetPageResponseDto })
  list(@CurrentUser() actor: Actor, @Query() query: AssetListQueryDto): Promise<Page<AssetSummary>> {
    return this.queryBus.execute(new ListAssetsQuery(actor, query));
  }

  @Post('depreciation')
  @RequirePermissions('scm:assets')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set how pieces depreciate (straight line), in bulk' })
  @ApiOkResponse({ type: ConfiguredResponseDto })
  configure(@CurrentUser() actor: Actor, @Body() dto: ConfigureDepreciationDto) {
    return this.commandBus.execute(
      new ConfigureDepreciationCommand(actor, dto.assetIds, {
        frequency: dto.frequency,
        lifeMonths: dto.lifeMonths,
        residual:
          dto.residualAmount !== undefined ? { amount: dto.residualAmount } : { percent: dto.residualPercent ?? 0 },
        startDate: dto.startDate,
        opening: dto.opening,
        cost: dto.cost,
      }),
    );
  }

  @Get(':id')
  @RequirePermissions('scm:read')
  @ApiOkResponse({ type: AssetResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto): Promise<AssetView> {
    return this.queryBus.execute(new GetAssetQuery(actor, params.id));
  }

  @Patch(':id')
  @RequirePermissions('scm:assets')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Write the piece's serial number or a note" })
  async describe(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: DescribeAssetDto) {
    await this.commandBus.execute(new DescribeAssetCommand(actor, params.id, dto));
  }
}

@ApiTags('supply-chain')
@ApiBearerAuth()
@Controller({ path: 'scm/depreciation-runs', version: '1' })
export class DepreciationRunsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @RequirePermissions('scm:read')
  @ApiOkResponse({ type: RunPageResponseDto })
  list(@CurrentUser() actor: Actor, @Query() query: RunListQueryDto): Promise<Page<RunSummary>> {
    return this.queryBus.execute(new ListRunsQuery(actor, query));
  }

  @Get('preview')
  @RequirePermissions('scm:assets')
  @ApiOperation({ summary: 'What a run up to the month end would charge, per piece' })
  @ApiOkResponse({ type: RunPreviewResponseDto })
  preview(@CurrentUser() actor: Actor, @Query() query: AsOfQueryDto): Promise<RunPreview> {
    return this.queryBus.execute(new PreviewDepreciationQuery(actor, query.asOf));
  }

  @Post()
  @RequirePermissions('scm:assets')
  @ApiOperation({ summary: 'Post every charge due up to a month end, with its voucher' })
  @ApiCreatedResponse({ type: PostedRunResponseDto })
  post(@CurrentUser() actor: Actor, @Body() dto: PostRunDto) {
    return this.commandBus.execute(new PostDepreciationCommand(actor, dto.asOf));
  }

  @Get(':id')
  @RequirePermissions('scm:read')
  @ApiOkResponse({ type: RunResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetRunQuery(actor, params.id));
  }

  @Post(':id/reverse')
  @RequirePermissions('scm:assets')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reverse the latest posted run; its periods become due again' })
  @ApiOkResponse({ type: ReversedRunResponseDto })
  reverse(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: ReverseRunDto) {
    return this.commandBus.execute(new ReverseDepreciationCommand(actor, params.id, dto.reason, dto.on));
  }
}

export const ASSET_CONTROLLERS = [FixedAssetsController, DepreciationRunsController];
