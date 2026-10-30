import { Module, type OnModuleInit } from '@nestjs/common';
import { DbContext } from '../../database/drizzle-transaction-manager.js';
import { RecordTypeRegistry } from '../../shared/application/records.js';
import { ReportRegistry } from '../../shared/application/reports.js';
import { MARKETING_HANDLERS, MarketingDesk } from './application/marketing.handlers.js';
import { MarketingReadRepository, MarketingRepository } from './application/marketing.messages.js';
import {
  DrizzleMarketingReadRepository,
  DrizzleMarketingRepository,
} from './infrastructure/persistence/drizzle-marketing.repositories.js';
import { marketingRecordTypes } from './infrastructure/persistence/marketing.record-stores.js';
import { marketingPerformanceReport } from './infrastructure/reports/marketing.reports.js';
import { MARKETING_CONTROLLERS } from './presentation/marketing.controllers.js';

/**
 * Marketing (old Marketing, step 12b): zones and areas; the team of managers, officers (each working a zone) and
 * agents; the referring doctors each officer looks after; monthly targets per officer and the gross; achievement as
 * the hospital's referred billing, read through ReferredBilling (doctors through OutpatientClinic).
 */
@Module({
  controllers: MARKETING_CONTROLLERS,
  providers: [
    ...MARKETING_HANDLERS,
    { provide: MarketingRepository, useClass: DrizzleMarketingRepository },
    { provide: MarketingReadRepository, useClass: DrizzleMarketingReadRepository },
  ],
})
export class MarketingModule implements OnModuleInit {
  constructor(
    private readonly records: RecordTypeRegistry,
    private readonly reports: ReportRegistry,
    private readonly context: DbContext,
    private readonly desk: MarketingDesk,
  ) {}

  onModuleInit(): void {
    for (const type of marketingRecordTypes(this.context)) this.records.register(type);
    this.reports.register(marketingPerformanceReport(this.desk));
  }
}
