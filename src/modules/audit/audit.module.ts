import { Global, Inject, Module, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/configuration.js';
import { UserDirectory } from '../../shared/application/contracts/user-directory.js';
import { AuditTrail } from '../../shared/application/ports/audit-trail.js';
import { ReportRegistry } from '../../shared/application/reports.js';
import {
  ActivityReadRepository,
  ActivitySummaryHandler,
  AUDIT_SETTINGS,
  SignInHistoryHandler,
  type AuditSettings,
} from './application/activity.queries.js';
import { AuditLogReadRepository, GetAuditLogsHandler } from './application/audit-log.queries.js';
import { DrizzleActivityReadRepository } from './infrastructure/drizzle-activity.repository.js';
import { DrizzleAuditLogReadRepository, DrizzleAuditTrail } from './infrastructure/drizzle-audit.repository.js';
import { activitySummaryReport, auditLogReport, signInsReport } from './infrastructure/reports/audit.reports.js';
import { AuditLogsController } from './presentation/audit-logs.controller.js';

/**
 * The audit log: security-relevant changes written by every module, searched by auditors; the activity summary
 * (old HealthSnapshot), sign-in history and their prints (step 12d).
 */
@Global()
@Module({
  controllers: [AuditLogsController],
  providers: [
    GetAuditLogsHandler,
    ActivitySummaryHandler,
    SignInHistoryHandler,
    { provide: AuditTrail, useClass: DrizzleAuditTrail },
    { provide: AuditLogReadRepository, useClass: DrizzleAuditLogReadRepository },
    { provide: ActivityReadRepository, useClass: DrizzleActivityReadRepository },
    {
      provide: AUDIT_SETTINGS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({ timeZone: config.reports.timeZone }),
    },
  ],
  exports: [AuditTrail],
})
export class AuditModule implements OnModuleInit {
  constructor(
    private readonly reports: ReportRegistry,
    private readonly logs: AuditLogReadRepository,
    private readonly activity: ActivityReadRepository,
    private readonly users: UserDirectory,
    @Inject(AUDIT_SETTINGS) private readonly settings: AuditSettings,
  ) {}

  onModuleInit(): void {
    const { timeZone } = this.settings;
    this.reports.register(auditLogReport(this.logs, this.users, timeZone));
    this.reports.register(activitySummaryReport(this.activity, this.users, timeZone));
    this.reports.register(signInsReport(this.activity, this.users, timeZone));
  }
}
