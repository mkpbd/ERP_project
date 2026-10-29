import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/configuration.js';
import { DocumentPrinter } from '../../shared/application/contracts/document-printer.js';
import { RegistryDocumentPrinter } from './application/document-printer.js';
import { REPORTING_SETTINGS, ReportRenderer } from './application/ports.js';
import { ReportAccessService } from './application/report-access.service.js';
import {
  GetReportHandler,
  GetRoleReportsHandler,
  ListAllReportsHandler,
  ListMyReportsHandler,
  RenderReportHandler,
  SetRoleReportsHandler,
} from './application/reporting.handlers.js';
import { RoleReportRepository } from './domain/repositories.js';
import { DrizzleRoleReportRepository } from './infrastructure/persistence/drizzle-role-report.repository.js';
import { ReportRenderingService } from './infrastructure/rendering/report-rendering.service.js';
import { ReportsController, RoleReportsController } from './presentation/reporting.controllers.js';

/**
 * Report catalog, role grants, rendering (Chromium HTML → PDF, pdfmake, Excel) and run auditing.
 * Replaces the old Web/Report service, ReportAndSps and ReportPermissions. Reports themselves are
 * defined by the module that owns the data and registered in the shared ReportRegistry. Global: it publishes the
 * DocumentPrinter (the patient portal prints patients' own documents through it).
 */
@Global()
@Module({
  controllers: [ReportsController, RoleReportsController],
  providers: [
    ListMyReportsHandler,
    ListAllReportsHandler,
    GetReportHandler,
    RenderReportHandler,
    GetRoleReportsHandler,
    SetRoleReportsHandler,
    ReportAccessService,
    {
      provide: REPORTING_SETTINGS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({ timeZone: config.reports.timeZone }),
    },
    { provide: ReportRenderer, useClass: ReportRenderingService },
    { provide: DocumentPrinter, useClass: RegistryDocumentPrinter },
    { provide: RoleReportRepository, useClass: DrizzleRoleReportRepository },
  ],
  exports: [DocumentPrinter],
})
export class ReportingModule {}
