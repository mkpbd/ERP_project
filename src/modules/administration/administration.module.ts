import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { DbContext } from '../../database/drizzle-transaction-manager.js';
import { OrganizationProfile } from '../../shared/application/contracts/organization-profile.js';
import { RecordTypeRegistry } from '../../shared/application/records.js';
import { ReportRegistry } from '../../shared/application/reports.js';
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
import { DrizzleOrganizationProfile } from './infrastructure/persistence/drizzle-organization-profile.js';
import { serviceUnitsReport } from './infrastructure/reports/service-units.report.js';
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
 * Admin feature and SuperAdmin AppSettings. Publishes OrganizationProfile (report letterhead).
 */
@Global()
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
    { provide: OrganizationProfile, useClass: DrizzleOrganizationProfile },
  ],
  exports: [OrganizationProfile],
})
export class AdministrationModule implements OnModuleInit {
  constructor(
    private readonly registry: RecordTypeRegistry,
    private readonly reports: ReportRegistry,
    private readonly context: DbContext,
  ) {}

  onModuleInit(): void {
    for (const type of administrationRecordTypes(this.context)) this.registry.register(type);
    this.reports.register(serviceUnitsReport(this.context));
  }
}
