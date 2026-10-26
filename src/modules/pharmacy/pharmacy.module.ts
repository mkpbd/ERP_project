import { Module, type OnModuleInit } from '@nestjs/common';
import { DbContext } from '../../database/drizzle-transaction-manager.js';
import { RecordTypeRegistry } from '../../shared/application/records.js';
import { ReportRegistry } from '../../shared/application/reports.js';
import { CATALOGUE_HANDLERS, CatalogueReadRepository } from './application/catalogue.handlers.js';
import { PURCHASE_HANDLERS } from './application/purchase.handlers.js';
import { PharmacyReadRepository } from './application/purchase.messages.js';
import {
  OpeningRepository,
  OrderRepository,
  PharmacyFacts,
  PharmacyLedger,
  PharmacySequences,
  ReceiveRepository,
} from './domain/repositories.js';
import { DrizzleCatalogueReadRepository } from './infrastructure/persistence/drizzle-catalogue.read-repository.js';
import { DrizzlePharmacyReadRepository } from './infrastructure/persistence/drizzle-pharmacy.read-repository.js';
import {
  DrizzleOpeningRepository,
  DrizzleOrderRepository,
  DrizzlePharmacyFacts,
  DrizzlePharmacyLedger,
  DrizzlePharmacySequences,
  DrizzleReceiveRepository,
} from './infrastructure/persistence/drizzle-purchase.repositories.js';
import { pharmacyRecordTypes } from './infrastructure/persistence/pharmacy.record-stores.js';
import { priceListReport } from './infrastructure/reports/catalogue.reports.js';
import { outletStockReport, purchaseOrderReport, receiveReport } from './infrastructure/reports/purchase.reports.js';
import { PHARMACY_CONTROLLERS } from './presentation/pharmacy.controllers.js';
import { PURCHASE_CONTROLLERS } from './presentation/purchase.controllers.js';

/**
 * Pharmacy: the medicine catalogue (generic groups and generics, formations, strengths, units, manufacturers,
 * brands and products), outlets, who works at each outlet and reorder levels (step 8a); purchase orders, stock
 * receives into outlets by lot, opening stock, the outlet movement ledger and posting purchases (step 8b).
 */
@Module({
  controllers: [...PHARMACY_CONTROLLERS, ...PURCHASE_CONTROLLERS],
  providers: [
    ...CATALOGUE_HANDLERS,
    ...PURCHASE_HANDLERS,
    { provide: CatalogueReadRepository, useClass: DrizzleCatalogueReadRepository },
    { provide: PharmacyReadRepository, useClass: DrizzlePharmacyReadRepository },
    { provide: PharmacySequences, useClass: DrizzlePharmacySequences },
    { provide: PharmacyLedger, useClass: DrizzlePharmacyLedger },
    { provide: PharmacyFacts, useClass: DrizzlePharmacyFacts },
    { provide: OrderRepository, useClass: DrizzleOrderRepository },
    { provide: ReceiveRepository, useClass: DrizzleReceiveRepository },
    { provide: OpeningRepository, useClass: DrizzleOpeningRepository },
  ],
})
export class PharmacyModule implements OnModuleInit {
  constructor(
    private readonly records: RecordTypeRegistry,
    private readonly reports: ReportRegistry,
    private readonly context: DbContext,
    private readonly catalogue: CatalogueReadRepository,
    private readonly pharmacy: PharmacyReadRepository,
  ) {}

  onModuleInit(): void {
    for (const type of pharmacyRecordTypes(this.context)) this.records.register(type);
    this.reports.register(priceListReport(this.catalogue));
    this.reports.register(purchaseOrderReport(this.pharmacy));
    this.reports.register(receiveReport(this.pharmacy));
    this.reports.register(outletStockReport(this.pharmacy));
  }
}
