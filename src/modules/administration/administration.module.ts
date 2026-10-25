import { Module, type OnModuleInit } from '@nestjs/common';
import { DbContext } from '../../database/drizzle-transaction-manager.js';
import { RecordTypeRegistry } from '../../shared/application/records.js';
import {
  GetSettingsHandler,
  GetTenantLogoHandler,
  RemoveTenantLogoHandler,
  SetTenantLogoHandler,
  UpdateSettingsHandler,
} from './application/administration.handlers.js';
import { SettingsRepository, TenantLogoRepository } from './domain/repositories.js';
import { administrationRecordTypes } from './infrastructure/persistence/administration.record-stores.js';
import {
  DrizzleSettingsRepository,
  DrizzleTenantLogoRepository,
} from './infrastructure/persistence/drizzle-administration.repositories.js';
import {
  AdminDepartmentsController,
  DiscountCategoriesController,
  EditorShortcutsController,
  InvestigationEntryPageControlsController,
  IpdAdmissionPageControlsController,
  PaymentChannelsController,
  PaymentModesController,
  PrintersController,
  ServeTypesController,
  ServiceUnitsController,
  SettingsController,
  TenantLogosController,
  TenantsController,
} from './presentation/administration.controllers.js';

/**
 * Admin masters, tenants and application settings. Ported from the old API's
 * Admin feature and SuperAdmin AppSettings.
 */
@Module({
  controllers: [
    AdminDepartmentsController,
    ServiceUnitsController,
    ServeTypesController,
    DiscountCategoriesController,
    PrintersController,
    PaymentModesController,
    PaymentChannelsController,
    EditorShortcutsController,
    IpdAdmissionPageControlsController,
    InvestigationEntryPageControlsController,
    // Logo routes (:id/logos/:slot) are registered alongside the tenant record routes.
    TenantsController,
    TenantLogosController,
    SettingsController,
  ],
  providers: [
    SetTenantLogoHandler,
    RemoveTenantLogoHandler,
    GetTenantLogoHandler,
    UpdateSettingsHandler,
    GetSettingsHandler,
    { provide: TenantLogoRepository, useClass: DrizzleTenantLogoRepository },
    { provide: SettingsRepository, useClass: DrizzleSettingsRepository },
  ],
})
export class AdministrationModule implements OnModuleInit {
  constructor(
    private readonly registry: RecordTypeRegistry,
    private readonly context: DbContext,
  ) {}

  onModuleInit(): void {
    for (const type of administrationRecordTypes(this.context)) this.registry.register(type);
  }
}
