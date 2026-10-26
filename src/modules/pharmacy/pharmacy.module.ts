import { Module, type OnModuleInit } from '@nestjs/common';
import { DbContext } from '../../database/drizzle-transaction-manager.js';
import { RecordTypeRegistry } from '../../shared/application/records.js';
import { ReportRegistry } from '../../shared/application/reports.js';
import { CATALOGUE_HANDLERS, CatalogueReadRepository } from './application/catalogue.handlers.js';
import { DrizzleCatalogueReadRepository } from './infrastructure/persistence/drizzle-catalogue.read-repository.js';
import { pharmacyRecordTypes } from './infrastructure/persistence/pharmacy.record-stores.js';
import { priceListReport } from './infrastructure/reports/catalogue.reports.js';
import { PHARMACY_CONTROLLERS } from './presentation/pharmacy.controllers.js';

/**
 * Pharmacy: the medicine catalogue (generic groups and generics, formations, strengths, units, manufacturers,
 * brands and products), outlets, who works at each outlet and reorder levels (step 8a).
 */
@Module({
  controllers: [...PHARMACY_CONTROLLERS],
  providers: [...CATALOGUE_HANDLERS, { provide: CatalogueReadRepository, useClass: DrizzleCatalogueReadRepository }],
})
export class PharmacyModule implements OnModuleInit {
  constructor(
    private readonly records: RecordTypeRegistry,
    private readonly reports: ReportRegistry,
    private readonly context: DbContext,
    private readonly catalogue: CatalogueReadRepository,
  ) {}

  onModuleInit(): void {
    for (const type of pharmacyRecordTypes(this.context)) this.records.register(type);
    this.reports.register(priceListReport(this.catalogue));
  }
}
