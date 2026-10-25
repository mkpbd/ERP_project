import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page } from '../../../shared/application/pagination.js';
import { ValidationError } from '../../../shared/domain/errors.js';
import { DOCUMENT_TYPES } from '../../../shared/domain/file-types.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import { createRecordController } from '../../../shared/presentation/record-controller.js';
import { IdParamDto } from '../../../shared/presentation/zod/common.schemas.js';
import { GL_ROLE, POSTING_SCHEDULE } from '../application/accounts.constants.js';
import {
  AddVoucherAttachmentCommand,
  CreateVoucherCommand,
  DeleteVoucherCommand,
  EditVoucherCommand,
  GetVoucherAttachmentQuery,
  GetVoucherQuery,
  ListVouchersQuery,
  PostVoucherCommand,
  RemoveVoucherAttachmentCommand,
  ReverseVoucherCommand,
  type VoucherSummary,
  type VoucherView,
} from '../application/voucher.messages.js';
import {
  AttachmentParamDto,
  AttachmentQueryDto,
  CreatedVoucherResponseDto,
  CreateGlRoleDto,
  CreatePostingScheduleDto,
  CreateVoucherDto,
  EditVoucherDto,
  GlRoleResponseDto,
  PostedResponseDto,
  PostingScheduleResponseDto,
  ReversedResponseDto,
  ReverseVoucherDto,
  UpdateGlRoleDto,
  UpdatePostingScheduleDto,
  VoucherListQueryDto,
  VoucherPageResponseDto,
  VoucherResponseDto,
  VoucherVersionDto,
  VoucherVersionQueryDto,
} from './dto/voucher.dto.js';

const configuration = {
  tag: 'accounts',
  readPermission: 'accounts:read',
  managePermission: 'accounts:manage',
} as const;

export const GlRolesController = createRecordController({
  ...configuration,
  className: 'GlRolesController',
  path: 'accounts/gl-roles',
  type: GL_ROLE,
  label: 'GL role',
  create: CreateGlRoleDto,
  update: UpdateGlRoleDto,
  response: GlRoleResponseDto,
});

export const PostingSchedulesController = createRecordController({
  ...configuration,
  className: 'PostingSchedulesController',
  path: 'accounts/posting-schedules',
  type: POSTING_SCHEDULE,
  label: 'posting schedule',
  create: CreatePostingScheduleDto,
  update: UpdatePostingScheduleDto,
  response: PostingScheduleResponseDto,
});

@ApiTags('accounts-vouchers')
@ApiBearerAuth()
@Controller({ path: 'accounts/vouchers', version: '1' })
export class VouchersController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @RequirePermissions('accounts:read')
  @ApiOkResponse({ type: VoucherPageResponseDto })
  list(@CurrentUser() actor: Actor, @Query() query: VoucherListQueryDto): Promise<Page<VoucherSummary>> {
    return this.queryBus.execute(new ListVouchersQuery(actor, query));
  }

  @Post()
  @ApiOperation({
    summary: 'Enter a voucher (debits must equal credits); post: true numbers and posts it at once (vouchers:post)',
  })
  @ApiCreatedResponse({ type: CreatedVoucherResponseDto })
  create(@CurrentUser() actor: Actor, @Body() dto: CreateVoucherDto) {
    const { lines, post, ...header } = dto;
    return this.commandBus.execute(new CreateVoucherCommand(actor, header, lines, post));
  }

  @Get(':id')
  @RequirePermissions('accounts:read')
  @ApiOkResponse({ type: VoucherResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto): Promise<VoucherView> {
    return this.queryBus.execute(new GetVoucherQuery(actor, params.id));
  }

  @Patch(':id')
  @RequirePermissions('vouchers:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Change a draft (lines are replaced when given)' })
  @ApiNoContentResponse()
  async edit(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: EditVoucherDto): Promise<void> {
    const { version, lines, ...header } = dto;
    await this.commandBus.execute(new EditVoucherCommand(actor, params.id, version, header, lines));
  }

  @Post(':id/post')
  @RequirePermissions('vouchers:post')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Number and post a draft in the open fiscal year of its date' })
  @ApiOkResponse({ type: PostedResponseDto })
  post(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: VoucherVersionDto) {
    return this.commandBus.execute(new PostVoucherCommand(actor, params.id, dto.version));
  }

  @Post(':id/reverse')
  @RequirePermissions('vouchers:post')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Post a reversing voucher (debits and credits swapped) for a posted voucher' })
  @ApiOkResponse({ type: ReversedResponseDto })
  reverse(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: ReverseVoucherDto) {
    return this.commandBus.execute(
      new ReverseVoucherCommand(actor, params.id, dto.version, dto.voucherDate, dto.narration),
    );
  }

  @Delete(':id')
  @RequirePermissions('vouchers:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a draft (posted vouchers are reversed instead)' })
  @ApiNoContentResponse()
  async remove(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Query() query: VoucherVersionQueryDto) {
    await this.commandBus.execute(new DeleteVoucherCommand(actor, params.id, query.version));
  }

  @Post(':id/attachments')
  @RequirePermissions('vouchers:write')
  @ApiOperation({ summary: 'Attach a supporting document as the raw body (PDF, PNG, JPEG or WebP, up to 5 MiB)' })
  @ApiConsumes(...DOCUMENT_TYPES)
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ApiCreatedResponse({ type: CreatedVoucherResponseDto })
  attach(
    @CurrentUser() actor: Actor,
    @Param() params: IdParamDto,
    @Query() query: AttachmentQueryDto,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
  ): Promise<{ id: string }> {
    if (!Buffer.isBuffer(body))
      throw new ValidationError(`Send the file bytes with Content-Type ${DOCUMENT_TYPES.join(', ')}`);
    return this.commandBus.execute(
      new AddVoucherAttachmentCommand(actor, params.id, query.fileName, contentType ?? '', body),
    );
  }

  @Get(':id/attachments/:attachmentId')
  @RequirePermissions('accounts:read')
  @ApiProduces(...DOCUMENT_TYPES)
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async attachment(@CurrentUser() actor: Actor, @Param() params: AttachmentParamDto): Promise<StreamableFile> {
    const file = await this.queryBus.execute(new GetVoucherAttachmentQuery(actor, params.id, params.attachmentId));
    return new StreamableFile(file.data, {
      type: file.contentType,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    });
  }

  @Delete(':id/attachments/:attachmentId')
  @RequirePermissions('vouchers:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async detach(@CurrentUser() actor: Actor, @Param() params: AttachmentParamDto): Promise<void> {
    await this.commandBus.execute(new RemoveVoucherAttachmentCommand(actor, params.id, params.attachmentId));
  }
}
