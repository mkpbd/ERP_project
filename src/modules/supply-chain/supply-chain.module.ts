import { Module, type OnModuleInit } from '@nestjs/common';
import { DbContext } from '../../database/drizzle-transaction-manager.js';
import { RecordTypeRegistry } from '../../shared/application/records.js';
import { ReportRegistry } from '../../shared/application/reports.js';
import { ASSET_HANDLERS, AssetReadRepository } from './application/asset.handlers.js';
import { ASSET_REQUEST_HANDLERS, AssetRequestReadRepository } from './application/asset-request.handlers.js';
import { DEPARTMENT_HANDLERS } from './application/department.handlers.js';
import { DepartmentReadRepository } from './application/department.messages.js';
import { PURCHASE_HANDLERS } from './application/purchase.handlers.js';
import { PurchaseReadRepository } from './application/purchase.messages.js';
import { STOCK_HANDLERS } from './application/stock.handlers.js';
import { STORE_HANDLERS } from './application/store.handlers.js';
import { StoreReadRepository } from './application/store.messages.js';
import { StockReadRepository } from './application/stock.messages.js';
import {
  AdjustmentRepository,
  AssetRegister,
  AssetRequestRepository,
  ApprovalLevels,
  CatalogueFacts,
  ConsumptionRepository,
  DepartmentReturnRepository,
  DepreciationRepository,
  GatePassRepository,
  IndentRepository,
  OpeningRepository,
  OrderRepository,
  ReceiveRepository,
  RequestRepository,
  RequisitionRepository,
  ScmSequences,
  StockLedger,
  StoreAccess,
  StoreMoveRepository,
  StudyRepository,
  SupplierReturnRepository,
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
import { gatePassReport, supplierReturnReport } from './infrastructure/reports/department.reports.js';
import {
  assetLabelsReport,
  assetRegisterReport,
  assetStickersReport,
  depreciationScheduleReport,
  maintenanceRegisterReport,
} from './infrastructure/reports/asset.reports.js';
import { disposalInvoiceReport } from './infrastructure/reports/disposal.reports.js';
import {
  expiryReport,
  gatePassRegisterReport,
  movementRegisterReport,
  stockMovementReport,
} from './infrastructure/reports/ledger.reports.js';
import { stockCardReport, stockReceiveReport, stockReport } from './infrastructure/reports/stock.reports.js';
import { stockTransferReport, storeIndentReport, storeIssueReport } from './infrastructure/reports/store.reports.js';
import { STOCK_CONTROLLERS } from './presentation/stock.controllers.js';
import { STORE_CONTROLLERS } from './presentation/store.controllers.js';
import { DEPARTMENT_CONTROLLERS } from './presentation/department.controllers.js';
import { ASSET_CONTROLLERS } from './presentation/asset.controllers.js';
import { ASSET_REQUEST_CONTROLLERS } from './presentation/asset-request.controllers.js';
import {
  DrizzleAssetRequestReadRepository,
  DrizzleAssetRequestRepository,
} from './infrastructure/persistence/drizzle-asset-request.repositories.js';
import {
  DrizzleAssetReadRepository,
  DrizzleAssetRegister,
  DrizzleDepreciationRepository,
} from './infrastructure/persistence/drizzle-asset.repositories.js';
import { DrizzleDepartmentReadRepository } from './infrastructure/persistence/drizzle-department.read-repository.js';
import {
  DrizzleAdjustmentRepository,
  DrizzleConsumptionRepository,
  DrizzleDepartmentReturnRepository,
  DrizzleGatePassRepository,
  DrizzleSupplierReturnRepository,
} from './infrastructure/persistence/drizzle-department.repositories.js';
import { DrizzleStoreReadRepository } from './infrastructure/persistence/drizzle-store.read-repository.js';
import {
  DrizzleIndentRepository,
  DrizzleRequestRepository,
  DrizzleStoreAccess,
  DrizzleStoreMoveRepository,
} from './infrastructure/persistence/drizzle-store.repositories.js';
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
 * opening stock and GRN faults, posting purchases to accounts (step 7c); store indents and their approval,
 * store requests, issues to departments and transfers between stores (step 7d); department stock (consumption,
 * returns, counts), supplier returns and gate passes (step 7e); the fixed asset register and straight-line
 * depreciation (step 7f); asset service and discard requests, disposal journals and scrap sales (step 7g).
 */
@Module({
  controllers: [
    ...SCM_RECORD_CONTROLLERS,
    ...PURCHASE_CONTROLLERS,
    ...STOCK_CONTROLLERS,
    ...STORE_CONTROLLERS,
    ...DEPARTMENT_CONTROLLERS,
    ...ASSET_CONTROLLERS,
    ...ASSET_REQUEST_CONTROLLERS,
  ],
  providers: [
    ...PURCHASE_HANDLERS,
    ...STOCK_HANDLERS,
    ...STORE_HANDLERS,
    ...DEPARTMENT_HANDLERS,
    ...ASSET_HANDLERS,
    ...ASSET_REQUEST_HANDLERS,
    { provide: AssetRequestRepository, useClass: DrizzleAssetRequestRepository },
    { provide: AssetRequestReadRepository, useClass: DrizzleAssetRequestReadRepository },
    { provide: AssetRegister, useClass: DrizzleAssetRegister },
    { provide: DepreciationRepository, useClass: DrizzleDepreciationRepository },
    { provide: AssetReadRepository, useClass: DrizzleAssetReadRepository },
    { provide: ConsumptionRepository, useClass: DrizzleConsumptionRepository },
    { provide: DepartmentReturnRepository, useClass: DrizzleDepartmentReturnRepository },
    { provide: AdjustmentRepository, useClass: DrizzleAdjustmentRepository },
    { provide: SupplierReturnRepository, useClass: DrizzleSupplierReturnRepository },
    { provide: GatePassRepository, useClass: DrizzleGatePassRepository },
    { provide: DepartmentReadRepository, useClass: DrizzleDepartmentReadRepository },
    { provide: IndentRepository, useClass: DrizzleIndentRepository },
    { provide: RequestRepository, useClass: DrizzleRequestRepository },
    { provide: StoreMoveRepository, useClass: DrizzleStoreMoveRepository },
    { provide: StoreAccess, useClass: DrizzleStoreAccess },
    { provide: StoreReadRepository, useClass: DrizzleStoreReadRepository },
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
    private readonly store: StoreReadRepository,
    private readonly departments: DepartmentReadRepository,
    private readonly assetRequests: AssetRequestReadRepository,
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
    this.reports.register(storeIndentReport(this.store));
    this.reports.register(storeIssueReport(this.store));
    this.reports.register(stockTransferReport(this.store));
    this.reports.register(supplierReturnReport(this.departments));
    this.reports.register(gatePassReport(this.departments));
    this.reports.register(disposalInvoiceReport(this.assetRequests));
    this.reports.register(stockMovementReport(this.context));
    this.reports.register(expiryReport(this.context));
    this.reports.register(movementRegisterReport(this.context));
    this.reports.register(gatePassRegisterReport(this.context));
    this.reports.register(assetRegisterReport(this.context));
    this.reports.register(depreciationScheduleReport(this.context));
    this.reports.register(maintenanceRegisterReport(this.context));
    this.reports.register(assetStickersReport(this.context));
    this.reports.register(assetLabelsReport(this.context));
  }
}
