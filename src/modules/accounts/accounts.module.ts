import { Module, type OnModuleInit } from '@nestjs/common';
import { DbContext } from '../../database/drizzle-transaction-manager.js';
import { RecordTypeRegistry } from '../../shared/application/records.js';
import { ReportRegistry } from '../../shared/application/reports.js';
import { ChartReadRepository, GetChartOfAccountsHandler } from './application/chart.js';
import { accountRecordTypes } from './infrastructure/persistence/accounts.record-stores.js';
import { DrizzleChartReadRepository } from './infrastructure/persistence/drizzle-chart.repository.js';
import { chartOfAccountsReport } from './infrastructure/reports/accounts.reports.js';
import { ACCOUNTS_RECORD_CONTROLLERS, ChartOfAccountsController } from './presentation/accounts.controllers.js';

/**
 * Accounts: the chart of accounts (nature → category → sub-category → level 4 → level 5 → GL account),
 * statement heads and accounting masters (step 6a).
 */
@Module({
  controllers: [...ACCOUNTS_RECORD_CONTROLLERS, ChartOfAccountsController],
  providers: [GetChartOfAccountsHandler, { provide: ChartReadRepository, useClass: DrizzleChartReadRepository }],
})
export class AccountsModule implements OnModuleInit {
  constructor(
    private readonly records: RecordTypeRegistry,
    private readonly reports: ReportRegistry,
    private readonly context: DbContext,
    private readonly chart: ChartReadRepository,
  ) {}

  onModuleInit(): void {
    for (const type of accountRecordTypes(this.context)) this.records.register(type);
    this.reports.register(chartOfAccountsReport(this.chart));
  }
}
