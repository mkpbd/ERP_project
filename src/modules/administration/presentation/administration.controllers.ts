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
  Put,
  StreamableFile,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Actor } from '../../../shared/application/actor.js';
import { ValidationError } from '../../../shared/domain/errors.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import { createRecordController } from '../../../shared/presentation/record-controller.js';
import {
  GetSettingsQuery,
  GetTenantLogoQuery,
  RemoveTenantLogoCommand,
  SetTenantLogoCommand,
  UpdateSettingsCommand,
} from '../application/administration.messages.js';
import {
  ADMIN_DEPARTMENT,
  DISCOUNT_CATEGORY,
  EDITOR_SHORTCUT,
  INVESTIGATION_ENTRY_PAGE_CONTROL,
  IPD_ADMISSION_PAGE_CONTROL,
  PAYMENT_CHANNEL,
  PAYMENT_MODE,
  PRINTER,
  SERVE_TYPE,
  SERVICE_UNIT,
  TENANT,
} from '../application/record-types.js';
import type { EditorMargins, GeneralSettings } from '../application/settings.js';
import { LOGO_CONTENT_TYPES } from '../domain/tenant-logo.js';
import {
  CreateDiscountCategoryDto,
  CreateEditorShortcutDto,
  CreateInvestigationEntryPageControlDto,
  CreateIpdAdmissionPageControlDto,
  CreateNamedRecordDto,
  CreatePaymentChannelDto,
  CreatePrinterDto,
  CreateServiceUnitDto,
  CreateTenantDto,
  DepartmentFilterDto,
  DiscountCategoryResponseDto,
  EditorMarginsResponseDto,
  EditorShortcutResponseDto,
  GeneralSettingsResponseDto,
  InvestigationEntryPageControlResponseDto,
  IpdAdmissionPageControlResponseDto,
  NamedRecordResponseDto,
  PaymentChannelResponseDto,
  PaymentModeFilterDto,
  PrinterResponseDto,
  ServiceUnitResponseDto,
  TenantLogoParamDto,
  TenantResponseDto,
  UpdateDiscountCategoryDto,
  UpdateEditorMarginsDto,
  UpdateEditorShortcutDto,
  UpdateGeneralSettingsDto,
  UpdateInvestigationEntryPageControlDto,
  UpdateIpdAdmissionPageControlDto,
  UpdateNamedRecordDto,
  UpdatePaymentChannelDto,
  UpdatePrinterDto,
  UpdateServiceUnitDto,
  UpdateTenantDto,
} from './dto/administration.dto.js';

const masters = { tag: 'admin', managePermission: 'masters:manage' } as const;

export const AdminDepartmentsController = createRecordController({
  ...masters,
  className: 'AdminDepartmentsController',
  path: 'admin/departments',
  type: ADMIN_DEPARTMENT,
  label: 'department',
  create: CreateNamedRecordDto,
  update: UpdateNamedRecordDto,
  response: NamedRecordResponseDto,
});

export const ServiceUnitsController = createRecordController({
  ...masters,
  className: 'ServiceUnitsController',
  path: 'admin/service-units',
  type: SERVICE_UNIT,
  label: 'service unit',
  create: CreateServiceUnitDto,
  update: UpdateServiceUnitDto,
  response: ServiceUnitResponseDto,
  filter: DepartmentFilterDto,
});

export const ServeTypesController = createRecordController({
  ...masters,
  className: 'ServeTypesController',
  path: 'admin/serve-types',
  type: SERVE_TYPE,
  label: 'serve type',
  create: CreateNamedRecordDto,
  update: UpdateNamedRecordDto,
  response: NamedRecordResponseDto,
});

export const DiscountCategoriesController = createRecordController({
  ...masters,
  className: 'DiscountCategoriesController',
  path: 'admin/discount-categories',
  type: DISCOUNT_CATEGORY,
  label: 'discount category',
  create: CreateDiscountCategoryDto,
  update: UpdateDiscountCategoryDto,
  response: DiscountCategoryResponseDto,
  filter: DepartmentFilterDto,
});

export const PrintersController = createRecordController({
  ...masters,
  className: 'PrintersController',
  path: 'admin/printers',
  type: PRINTER,
  label: 'printer',
  create: CreatePrinterDto,
  update: UpdatePrinterDto,
  response: PrinterResponseDto,
});

export const PaymentModesController = createRecordController({
  ...masters,
  className: 'PaymentModesController',
  path: 'admin/payment-modes',
  type: PAYMENT_MODE,
  label: 'payment mode',
  create: CreateNamedRecordDto,
  update: UpdateNamedRecordDto,
  response: NamedRecordResponseDto,
});

export const PaymentChannelsController = createRecordController({
  ...masters,
  className: 'PaymentChannelsController',
  path: 'admin/payment-channels',
  type: PAYMENT_CHANNEL,
  label: 'payment channel',
  create: CreatePaymentChannelDto,
  update: UpdatePaymentChannelDto,
  response: PaymentChannelResponseDto,
  filter: PaymentModeFilterDto,
});

export const EditorShortcutsController = createRecordController({
  ...masters,
  className: 'EditorShortcutsController',
  path: 'admin/editor-shortcuts',
  type: EDITOR_SHORTCUT,
  label: 'editor shortcut',
  create: CreateEditorShortcutDto,
  update: UpdateEditorShortcutDto,
  response: EditorShortcutResponseDto,
});

export const IpdAdmissionPageControlsController = createRecordController({
  ...masters,
  className: 'IpdAdmissionPageControlsController',
  path: 'admin/page-controls/ipd-admission',
  type: IPD_ADMISSION_PAGE_CONTROL,
  label: 'IPD admission page control',
  create: CreateIpdAdmissionPageControlDto,
  update: UpdateIpdAdmissionPageControlDto,
  response: IpdAdmissionPageControlResponseDto,
});

export const InvestigationEntryPageControlsController = createRecordController({
  ...masters,
  className: 'InvestigationEntryPageControlsController',
  path: 'admin/page-controls/investigation-entry',
  type: INVESTIGATION_ENTRY_PAGE_CONTROL,
  label: 'investigation entry page control',
  create: CreateInvestigationEntryPageControlDto,
  update: UpdateInvestigationEntryPageControlDto,
  response: InvestigationEntryPageControlResponseDto,
});

export const TenantsController = createRecordController({
  tag: 'admin',
  managePermission: 'tenants:manage',
  className: 'TenantsController',
  path: 'admin/tenants',
  type: TENANT,
  label: 'tenant',
  create: CreateTenantDto,
  update: UpdateTenantDto,
  response: TenantResponseDto,
});

@ApiTags('admin')
@ApiBearerAuth()
@Controller({ path: 'admin/tenants', version: '1' })
export class TenantLogosController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get(':id/logos/:slot')
  @ApiOperation({ summary: "A tenant's logo image (primary or secondary)" })
  @ApiProduces(...LOGO_CONTENT_TYPES)
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async logo(@CurrentUser() actor: Actor, @Param() params: TenantLogoParamDto): Promise<StreamableFile> {
    const logo = await this.queryBus.execute(new GetTenantLogoQuery(actor, params.id, params.slot));
    return new StreamableFile(logo.data, { type: logo.contentType, disposition: 'inline' });
  }

  @Put(':id/logos/:slot')
  @RequirePermissions('tenants:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Upload a logo as the raw request body (PNG, JPEG or WebP, up to 1 MiB)' })
  @ApiConsumes(...LOGO_CONTENT_TYPES)
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ApiNoContentResponse()
  async setLogo(
    @CurrentUser() actor: Actor,
    @Param() params: TenantLogoParamDto,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
  ): Promise<void> {
    if (!Buffer.isBuffer(body)) {
      throw new ValidationError('Send the image bytes with Content-Type image/png, image/jpeg or image/webp');
    }
    await this.commandBus.execute(new SetTenantLogoCommand(actor, params.id, params.slot, contentType ?? '', body));
  }

  @Delete(':id/logos/:slot')
  @RequirePermissions('tenants:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async removeLogo(@CurrentUser() actor: Actor, @Param() params: TenantLogoParamDto): Promise<void> {
    await this.commandBus.execute(new RemoveTenantLogoCommand(actor, params.id, params.slot));
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller({ path: 'admin/settings', version: '1' })
export class SettingsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('general')
  @ApiOperation({ summary: 'Application-wide settings (old SuperAdmin AppSettings)' })
  @ApiOkResponse({ type: GeneralSettingsResponseDto })
  general(@CurrentUser() actor: Actor): Promise<GeneralSettings> {
    return this.queryBus.execute(new GetSettingsQuery<GeneralSettings>(actor, 'general'));
  }

  @Patch('general')
  @RequirePermissions('settings:manage')
  @ApiOkResponse({ type: GeneralSettingsResponseDto })
  updateGeneral(@CurrentUser() actor: Actor, @Body() dto: UpdateGeneralSettingsDto): Promise<GeneralSettings> {
    return this.commandBus.execute(new UpdateSettingsCommand<GeneralSettings>(actor, 'general', dto));
  }

  @Get('editor-margins')
  @ApiOperation({ summary: 'Report editor page margins' })
  @ApiOkResponse({ type: EditorMarginsResponseDto })
  editorMargins(@CurrentUser() actor: Actor): Promise<EditorMargins> {
    return this.queryBus.execute(new GetSettingsQuery<EditorMargins>(actor, 'editor-margins'));
  }

  @Patch('editor-margins')
  @RequirePermissions('settings:manage')
  @ApiOkResponse({ type: EditorMarginsResponseDto })
  updateEditorMargins(@CurrentUser() actor: Actor, @Body() dto: UpdateEditorMarginsDto): Promise<EditorMargins> {
    return this.commandBus.execute(new UpdateSettingsCommand<EditorMargins>(actor, 'editor-margins', dto));
  }
}
