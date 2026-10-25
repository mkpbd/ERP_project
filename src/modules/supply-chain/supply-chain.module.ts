import { Module, type OnModuleInit } from '@nestjs/common';
import { DbContext } from '../../database/drizzle-transaction-manager.js';
import { RecordTypeRegistry } from '../../shared/application/records.js';
import { ReportRegistry } from '../../shared/application/reports.js';
import { supplyChainRecordTypes } from './infrastructure/persistence/supply-chain.record-stores.js';
import { itemCatalogueReport, supplierListReport } from './infrastructure/reports/catalogue.reports.js';
import { SCM_RECORD_CONTROLLERS } from './presentation/supply-chain.controllers.js';

/**
 * Supply chain: main stores and sub-stores, store departments and who may indent or issue, the item catalogue
 * (category / group → item → variant) and suppliers (step 7a).
 */
@Module({
  controllers: [...SCM_RECORD_CONTROLLERS],
})
export class SupplyChainModule implements OnModuleInit {
  constructor(
    private readonly records: RecordTypeRegistry,
    private readonly reports: ReportRegistry,
    private readonly context: DbContext,
  ) {}

  onModuleInit(): void {
    for (const type of supplyChainRecordTypes(this.context)) this.records.register(type);
    this.reports.register(itemCatalogueReport(this.context));
    this.reports.register(supplierListReport(this.context));
  }
}
