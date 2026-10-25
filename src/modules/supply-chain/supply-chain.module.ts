import { Module, type OnModuleInit } from '@nestjs/common';
import { DbContext } from '../../database/drizzle-transaction-manager.js';
import { RecordTypeRegistry } from '../../shared/application/records.js';
import { ReportRegistry } from '../../shared/application/reports.js';
import { PURCHASE_HANDLERS } from './application/purchase.handlers.js';
import { PurchaseReadRepository } from './application/purchase.messages.js';
import { STOCK_HANDLERS } from './application/stock.handlers.js';
import { StockReadRepository } from './application/stock.messages.js';
import {
  ApprovalLevels,
  CatalogueFacts,
  OpeningRepository,
  OrderRepository,
  ReceiveRepository,
  RequisitionRepository,
  ScmSequences,
  StockLedger,
  StudyRepository,
} from './domain/repositories.js';
import { DrizzlePurchaseReadRepository } from './infrastructure/persistence/drizzle-purchase.read-repository.js';
import {
  DrizzleApprovalLevels,
  DrizzleOrderRepository,
  DrizzleRequisitionRepository,
  DrizzleScmSequences,
  DrizzleStudyRepository,
} from './infrastructure/persistence/drizzle-purchase.repositories.js';
import { DrizzleStockReadRepository } from './infrastructure/persistence/drizzle-stock.read-repository.js';
import {
  DrizzleCatalogueFacts,
  DrizzleOpeningRepository,
  DrizzleReceiveRepository,
  DrizzleStockLedger,
} from './infrastructure/persistence/drizzle-stock.repositories.js';
import { stockCardReport, stockReceiveReport, stockReport } from './infrastructure/reports/stock.reports.js';
import { STOCK_CONTROLLERS } from './presentation/stock.controllers.js';
import { supplyChainRecordTypes } from './infrastructure/persistence/supply-chain.record-stores.js';
import { itemCatalogueReport, supplierListReport } from './infrastructure/reports/catalogue.reports.js';
import {
  comparativeStudyReport,
  purchaseOrderReport,
  requisitionReport,
} from './infrastructure/reports/purchase.reports.js';
import { PURCHASE_CONTROLLERS } from './presentation/purchase.controllers.js';
import { SCM_RECORD_CONTROLLERS } from './presentation/supply-chain.controllers.js';

/**
 * Supply chain: main stores and sub-stores, store departments and who may indent or issue, the item catalogue
 * (category / group → item → variant) and suppliers (step 7a); purchase requisitions, comparative studies
 * and purchase orders with their approval levels (step 7b); stock receives, lots, the stock movement ledger,
 * opening stock and GRN faults, posting purchases to accounts (step 7c).
 */
@Module({
  controllers: [...SCM_RECORD_CONTROLLERS, ...PURCHASE_CONTROLLERS, ...STOCK_CONTROLLERS],
  providers: [
    ...PURCHASE_HANDLERS,
    ...STOCK_HANDLERS,
    { provide: StockLedger, useClass: DrizzleStockLedger },
    { provide: CatalogueFacts, useClass: DrizzleCatalogueFacts },
    { provide: ReceiveRepository, useClass: DrizzleReceiveRepository },
    { provide: OpeningRepository, useClass: DrizzleOpeningRepository },
    { provide: StockReadRepository, useClass: DrizzleStockReadRepository },
    { provide: ScmSequences, useClass: DrizzleScmSequences },
    { provide: ApprovalLevels, useClass: DrizzleApprovalLevels },
    { provide: RequisitionRepository, useClass: DrizzleRequisitionRepository },
    { provide: StudyRepository, useClass: DrizzleStudyRepository },
    { provide: OrderRepository, useClass: DrizzleOrderRepository },
    { provide: PurchaseReadRepository, useClass: DrizzlePurchaseReadRepository },
  ],
})
export class SupplyChainModule implements OnModuleInit {
  constructor(
    private readonly records: RecordTypeRegistry,
    private readonly reports: ReportRegistry,
    private readonly context: DbContext,
    private readonly purchases: PurchaseReadRepository,
    private readonly stock: StockReadRepository,
  ) {}

  onModuleInit(): void {
    for (const type of supplyChainRecordTypes(this.context)) this.records.register(type);
    this.reports.register(itemCatalogueReport(this.context));
    this.reports.register(supplierListReport(this.context));
    this.reports.register(requisitionReport(this.purchases));
    this.reports.register(comparativeStudyReport(this.purchases));
    this.reports.register(purchaseOrderReport(this.purchases));
    this.reports.register(stockReceiveReport(this.stock));
    this.reports.register(stockReport(this.stock));
    this.reports.register(stockCardReport(this.stock));
  }
}
