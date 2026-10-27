import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { DbContext } from '../../database/drizzle-transaction-manager.js';
import { InpatientMedicine } from '../../shared/application/contracts/inpatient-medicine.js';
import { InpatientRegister } from '../../shared/application/contracts/inpatient-register.js';
import { SupplierDirectory } from '../../shared/application/contracts/supplier-directory.js';
import { UserDirectory } from '../../shared/application/contracts/user-directory.js';
import { RecordTypeRegistry } from '../../shared/application/records.js';
import { ReportRegistry } from '../../shared/application/reports.js';
import { CATALOGUE_HANDLERS, CatalogueReadRepository } from './application/catalogue.handlers.js';
import { PURCHASE_HANDLERS } from './application/purchase.handlers.js';
import { PharmacyReadRepository } from './application/purchase.messages.js';
import { SUPPLIER_HANDLERS } from './application/supplier.handlers.js';
import { SupplierReadRepository } from './application/supplier.messages.js';
import { COUNT_HANDLERS } from './application/count.handlers.js';
import { CountReadRepository } from './application/count.messages.js';
import { RETURN_HANDLERS } from './application/return.handlers.js';
import { ReturnReadRepository } from './application/return.messages.js';
import { SALE_HANDLERS } from './application/sale.handlers.js';
import { SaleReadRepository } from './application/sale.messages.js';
import { TRANSFER_HANDLERS } from './application/transfer.handlers.js';
import { WARD_HANDLERS } from './application/ward.handlers.js';
import { WardReadRepository } from './application/ward.messages.js';
import { WardRepository } from './domain/repositories.js';
import {
  DrizzleInpatientMedicine,
  DrizzleWardReadRepository,
  DrizzleWardRepository,
} from './infrastructure/persistence/drizzle-ward.repositories.js';
import { wardMedicineReport } from './infrastructure/reports/ward.reports.js';
import { WARD_CONTROLLERS } from './presentation/ward.controllers.js';
import { TransferReadRepository } from './application/transfer.messages.js';
import {
  OpeningRepository,
  OrderRepository,
  PaymentRepository,
  PharmacyFacts,
  PharmacyLedger,
  PharmacySequences,
  ReceiveRepository,
  SupplierReturnRepository,
  IndentRepository,
  TransferRepository,
  DiscountRules,
  SaleRepository,
  ReturnPolicies,
  SaleReturnRepository,
  StockCountRepository,
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
import { DrizzleSupplierReadRepository } from './infrastructure/persistence/drizzle-supplier.read-repository.js';
import {
  DrizzlePaymentRepository,
  DrizzleSupplierReturnRepository,
} from './infrastructure/persistence/drizzle-supplier.repositories.js';
import {
  DrizzleReturnPolicies,
  DrizzleReturnReadRepository,
  DrizzleSaleReturnRepository,
} from './infrastructure/persistence/drizzle-return.repositories.js';
import {
  DrizzleCountReadRepository,
  DrizzleStockCountRepository,
} from './infrastructure/persistence/drizzle-count.repositories.js';
import { DrizzleSaleReadRepository } from './infrastructure/persistence/drizzle-sale.read-repository.js';
import { DrizzleDiscountRules, DrizzleSaleRepository } from './infrastructure/persistence/drizzle-sale.repositories.js';
import { DrizzleTransferReadRepository } from './infrastructure/persistence/drizzle-transfer.read-repository.js';
import {
  DrizzleIndentRepository,
  DrizzleTransferRepository,
} from './infrastructure/persistence/drizzle-transfer.repositories.js';
import { pharmacyRecordTypes } from './infrastructure/persistence/pharmacy.record-stores.js';
import { priceListReport } from './infrastructure/reports/catalogue.reports.js';
import { outletStockReport, purchaseOrderReport, receiveReport } from './infrastructure/reports/purchase.reports.js';
import { PHARMACY_CONTROLLERS } from './presentation/pharmacy.controllers.js';
import { supplierPaymentReport, supplierReturnReport } from './infrastructure/reports/supplier.reports.js';
import { PURCHASE_CONTROLLERS } from './presentation/purchase.controllers.js';
import { SUPPLIER_CONTROLLERS } from './presentation/supplier.controllers.js';
import { transferReport } from './infrastructure/reports/transfer.reports.js';
import { TRANSFER_CONTROLLERS } from './presentation/transfer.controllers.js';
import { memberDuesReport, saleReceiptReport } from './infrastructure/reports/sale.reports.js';
import { SALE_CONTROLLERS } from './presentation/sale.controllers.js';
import { returnReceiptReport } from './infrastructure/reports/return.reports.js';
import { RETURN_CONTROLLERS } from './presentation/return.controllers.js';
import { countResultReport, countSheetReport } from './infrastructure/reports/count.reports.js';
import { COUNT_CONTROLLERS } from './presentation/count.controllers.js';
import {
  expiryReport,
  physicalInventoryReport,
  productLedgerReport,
  stockMovementReport,
} from './infrastructure/reports/stock-analysis.reports.js';
import {
  cashCounterReport,
  purchaseSummaryReport,
  salesSummaryReport,
} from './infrastructure/reports/trade-analysis.reports.js';

/**
 * Pharmacy: the medicine catalogue (generic groups and generics, formations, strengths, units, manufacturers,
 * brands and products), outlets, who works at each outlet and reorder levels (step 8a); purchase orders, stock
 * receives into outlets by lot, opening stock, the outlet movement ledger and posting purchases (step 8b);
 * supplier payments over receives and supplier returns settled by replacements (step 8c); outlet indents and
 * transfers between outlets (step 8d); counter sales with discount rules, loyal members and their dues (step 8e);
 * returns from customers within the return period (step 8f); stock counts applied lot by lot (step 8g); stock, trade and cash counter reports (step 8h);
 * ward indents, medicine sent to and back from the wards for admitted patients, charged to their indoor bills (step 8i).
 * Global: it publishes the medicine charged to admissions (InpatientMedicine) for the hospital's indoor bill.
 */
@Global()
@Module({
  controllers: [
    ...PHARMACY_CONTROLLERS,
    ...PURCHASE_CONTROLLERS,
    ...SUPPLIER_CONTROLLERS,
    ...TRANSFER_CONTROLLERS,
    ...SALE_CONTROLLERS,
    ...RETURN_CONTROLLERS,
    ...COUNT_CONTROLLERS,
    ...WARD_CONTROLLERS,
  ],
  providers: [
    ...CATALOGUE_HANDLERS,
    ...PURCHASE_HANDLERS,
    ...SUPPLIER_HANDLERS,
    ...TRANSFER_HANDLERS,
    ...SALE_HANDLERS,
    ...RETURN_HANDLERS,
    ...COUNT_HANDLERS,
    ...WARD_HANDLERS,
    { provide: CatalogueReadRepository, useClass: DrizzleCatalogueReadRepository },
    { provide: PharmacyReadRepository, useClass: DrizzlePharmacyReadRepository },
    { provide: PharmacySequences, useClass: DrizzlePharmacySequences },
    { provide: PharmacyLedger, useClass: DrizzlePharmacyLedger },
    { provide: PharmacyFacts, useClass: DrizzlePharmacyFacts },
    { provide: OrderRepository, useClass: DrizzleOrderRepository },
    { provide: ReceiveRepository, useClass: DrizzleReceiveRepository },
    { provide: OpeningRepository, useClass: DrizzleOpeningRepository },
    { provide: PaymentRepository, useClass: DrizzlePaymentRepository },
    { provide: SupplierReturnRepository, useClass: DrizzleSupplierReturnRepository },
    { provide: SupplierReadRepository, useClass: DrizzleSupplierReadRepository },
    { provide: IndentRepository, useClass: DrizzleIndentRepository },
    { provide: TransferRepository, useClass: DrizzleTransferRepository },
    { provide: TransferReadRepository, useClass: DrizzleTransferReadRepository },
    { provide: DiscountRules, useClass: DrizzleDiscountRules },
    { provide: SaleRepository, useClass: DrizzleSaleRepository },
    { provide: SaleReadRepository, useClass: DrizzleSaleReadRepository },
    { provide: ReturnPolicies, useClass: DrizzleReturnPolicies },
    { provide: SaleReturnRepository, useClass: DrizzleSaleReturnRepository },
    { provide: ReturnReadRepository, useClass: DrizzleReturnReadRepository },
    { provide: StockCountRepository, useClass: DrizzleStockCountRepository },
    { provide: CountReadRepository, useClass: DrizzleCountReadRepository },
    { provide: WardRepository, useClass: DrizzleWardRepository },
    { provide: WardReadRepository, useClass: DrizzleWardReadRepository },
    { provide: InpatientMedicine, useClass: DrizzleInpatientMedicine },
  ],
  exports: [InpatientMedicine],
})
export class PharmacyModule implements OnModuleInit {
  constructor(
    private readonly records: RecordTypeRegistry,
    private readonly reports: ReportRegistry,
    private readonly context: DbContext,
    private readonly catalogue: CatalogueReadRepository,
    private readonly pharmacy: PharmacyReadRepository,
    private readonly suppliers: SupplierReadRepository,
    private readonly transfers: TransferReadRepository,
    private readonly sales: SaleReadRepository,
    private readonly returns: ReturnReadRepository,
    private readonly counts: CountReadRepository,
    private readonly supplierDirectory: SupplierDirectory,
    private readonly users: UserDirectory,
    private readonly wards: WardReadRepository,
    private readonly inpatients: InpatientRegister,
  ) {}

  onModuleInit(): void {
    for (const type of pharmacyRecordTypes(this.context)) this.records.register(type);
    this.reports.register(priceListReport(this.catalogue));
    this.reports.register(purchaseOrderReport(this.pharmacy));
    this.reports.register(receiveReport(this.pharmacy));
    this.reports.register(outletStockReport(this.pharmacy));
    this.reports.register(supplierPaymentReport(this.suppliers));
    this.reports.register(supplierReturnReport(this.suppliers));
    this.reports.register(transferReport(this.transfers));
    this.reports.register(saleReceiptReport(this.sales));
    this.reports.register(memberDuesReport(this.sales));
    this.reports.register(returnReceiptReport(this.returns));
    this.reports.register(countSheetReport(this.counts));
    this.reports.register(countResultReport(this.counts));
    this.reports.register(productLedgerReport(this.context));
    this.reports.register(stockMovementReport(this.context));
    this.reports.register(expiryReport(this.context));
    this.reports.register(physicalInventoryReport(this.context));
    this.reports.register(purchaseSummaryReport(this.context, this.supplierDirectory));
    this.reports.register(salesSummaryReport(this.context, this.users));
    this.reports.register(cashCounterReport(this.context, this.users));
    this.reports.register(wardMedicineReport(this.wards, this.inpatients));
  }
}
