import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { DbContext } from '../../database/drizzle-transaction-manager.js';
import { LedgerPosting } from '../../shared/application/contracts/ledger-posting.js';
import { RecordTypeRegistry } from '../../shared/application/records.js';
import { ReportRegistry } from '../../shared/application/reports.js';
import { ChartReadRepository, GetChartOfAccountsHandler } from './application/chart.js';
import { VOUCHER_HANDLERS, VoucherBook, VoucherLedgerPosting } from './application/voucher.handlers.js';
import { VoucherReadRepository } from './application/voucher.messages.js';
import { LedgerFacts, VoucherRepository } from './domain/repositories.js';
import {
  DrizzleLedgerFacts,
  DrizzleVoucherReadRepository,
  DrizzleVoucherRepository,
} from './infrastructure/persistence/drizzle-voucher.repositories.js';
import { accountRecordTypes } from './infrastructure/persistence/accounts.record-stores.js';
import { DrizzleChartReadRepository } from './infrastructure/persistence/drizzle-chart.repository.js';
import { chartOfAccountsReport, voucherReport } from './infrastructure/reports/accounts.reports.js';
import {
  GlRolesController,
  PostingSchedulesController,
  VouchersController,
} from './presentation/voucher.controllers.js';
import { ACCOUNTS_RECORD_CONTROLLERS, ChartOfAccountsController } from './presentation/accounts.controllers.js';

/**
 * Accounts: the chart of accounts (nature → category → sub-category → level 4 → level 5 → GL account),
 * statement heads and accounting masters (step 6a); vouchers, posting and account configuration (step 6b).
 * Publishes LedgerPosting so other modules can post vouchers.
 */
@Global()
@Module({
  controllers: [
    ...ACCOUNTS_RECORD_CONTROLLERS,
    ChartOfAccountsController,
    GlRolesController,
    PostingSchedulesController,
    VouchersController,
  ],
  providers: [
    GetChartOfAccountsHandler,
    ...VOUCHER_HANDLERS,
    VoucherBook,
    { provide: ChartReadRepository, useClass: DrizzleChartReadRepository },
    { provide: VoucherRepository, useClass: DrizzleVoucherRepository },
    { provide: LedgerFacts, useClass: DrizzleLedgerFacts },
    { provide: VoucherReadRepository, useClass: DrizzleVoucherReadRepository },
    { provide: LedgerPosting, useClass: VoucherLedgerPosting },
  ],
  exports: [LedgerPosting],
})
export class AccountsModule implements OnModuleInit {
  constructor(
    private readonly records: RecordTypeRegistry,
    private readonly reports: ReportRegistry,
    private readonly context: DbContext,
    private readonly chart: ChartReadRepository,
    private readonly vouchers: VoucherReadRepository,
  ) {}

  onModuleInit(): void {
    for (const type of accountRecordTypes(this.context)) this.records.register(type);
    this.reports.register(chartOfAccountsReport(this.chart));
    this.reports.register(voucherReport(this.vouchers));
  }
}
