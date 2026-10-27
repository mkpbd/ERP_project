import { Module, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/configuration.js';
import { DiagnosticOrders } from '../../shared/application/contracts/diagnostic-orders.js';
import { OrganizationProfile } from '../../shared/application/contracts/organization-profile.js';
import { UserDirectory } from '../../shared/application/contracts/user-directory.js';
import { ReportRegistry } from '../../shared/application/reports.js';
import { LAB_HANDLERS, LAB_SETTINGS } from './application/lab.handlers.js';
import { LabReadRepository } from './application/lab.messages.js';
import { LabRepository } from './domain/repositories.js';
import {
  DrizzleLabReadRepository,
  DrizzleLabRepository,
} from './infrastructure/persistence/drizzle-lab.repositories.js';
import { labReport } from './infrastructure/reports/lab.reports.js';
import { LabController } from './presentation/lab.controllers.js';

/**
 * Laboratory (old Diag sample collection, pathology results and report publishing): each lab test's parameters and
 * normal ranges; samples with lab numbers for the hospital's diagnostic bills (read through DiagnosticOrders);
 * results entered, verified by someone else, printed and handed over (step 10c).
 */
@Module({
  controllers: [LabController],
  providers: [
    ...LAB_HANDLERS,
    { provide: LabRepository, useClass: DrizzleLabRepository },
    { provide: LabReadRepository, useClass: DrizzleLabReadRepository },
    {
      provide: LAB_SETTINGS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({ timeZone: config.reports.timeZone }),
    },
  ],
})
export class LaboratoryModule implements OnModuleInit {
  constructor(
    private readonly reports: ReportRegistry,
    private readonly read: LabReadRepository,
    private readonly orders: DiagnosticOrders,
    private readonly organization: OrganizationProfile,
    private readonly users: UserDirectory,
  ) {}

  onModuleInit(): void {
    this.reports.register(labReport(this.read, this.orders, this.organization, this.users));
  }
}
