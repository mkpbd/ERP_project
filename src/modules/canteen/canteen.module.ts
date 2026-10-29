import { Module, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/configuration.js';
import { DbContext } from '../../database/drizzle-transaction-manager.js';
import { RecordTypeRegistry } from '../../shared/application/records.js';
import { ReportRegistry } from '../../shared/application/reports.js';
import { CANTEEN_HANDLERS } from './application/canteen.handlers.js';
import { CANTEEN_SETTINGS, CanteenReadRepository } from './application/canteen.messages.js';
import { CanteenRepository } from './domain/repositories.js';
import { canteenRecordTypes } from './infrastructure/persistence/canteen.record-stores.js';
import {
  DrizzleCanteenReadRepository,
  DrizzleCanteenRepository,
} from './infrastructure/persistence/drizzle-canteen.repositories.js';
import {
  canteenItemSalesReport,
  canteenMemberDuesReport,
  canteenReceiptReport,
} from './infrastructure/reports/canteen.reports.js';
import { CANTEEN_CONTROLLERS } from './presentation/canteen.controllers.js';

/**
 * Canteen (old Canteen, step 12a): the menu with general and staff rates and VAT, outlets and who sells there,
 * members who may eat on credit, cash sales posted to the ledger, members' dues. Packaged goods are store items of the
 * supply chain, used up from the outlet's store department through DepartmentStock; staff through StaffDirectory.
 */
@Module({
  controllers: CANTEEN_CONTROLLERS,
  providers: [
    ...CANTEEN_HANDLERS,
    { provide: CanteenRepository, useClass: DrizzleCanteenRepository },
    { provide: CanteenReadRepository, useClass: DrizzleCanteenReadRepository },
    {
      provide: CANTEEN_SETTINGS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({ timeZone: config.reports.timeZone }),
    },
  ],
})
export class CanteenModule implements OnModuleInit {
  constructor(
    private readonly records: RecordTypeRegistry,
    private readonly reports: ReportRegistry,
    private readonly context: DbContext,
    private readonly read: CanteenReadRepository,
  ) {}

  onModuleInit(): void {
    for (const type of canteenRecordTypes(this.context)) this.records.register(type);
    this.reports.register(canteenReceiptReport(this.read));
    this.reports.register(canteenItemSalesReport(this.read));
    this.reports.register(canteenMemberDuesReport(this.read));
  }
}
