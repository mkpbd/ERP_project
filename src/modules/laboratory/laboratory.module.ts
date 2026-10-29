import { Module, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/configuration.js';
import { DepartmentStock } from '../../shared/application/contracts/department-stock.js';
import { DiagnosticOrders } from '../../shared/application/contracts/diagnostic-orders.js';
import { DbContext } from '../../database/drizzle-transaction-manager.js';
import { OrganizationProfile } from '../../shared/application/contracts/organization-profile.js';
import { UserDirectory } from '../../shared/application/contracts/user-directory.js';
import { PatientDocumentRegistry } from '../../shared/application/patient-documents.js';
import { ReportRegistry } from '../../shared/application/reports.js';
import { laboratoryDocuments } from './infrastructure/persistence/laboratory.patient-documents.js';
import { IMAGING_HANDLERS } from './application/imaging.handlers.js';
import { ImagingReadRepository } from './application/imaging.messages.js';
import { LAB_HANDLERS } from './application/lab.handlers.js';
import { REAGENT_HANDLERS } from './application/reagent.handlers.js';
import { ReagentUser } from './application/reagent-use.js';
import { LAB_SETTINGS, LabReadRepository } from './application/lab.messages.js';
import { ImagingRepository, LabRepository, ReagentRepository } from './domain/repositories.js';
import { DrizzleReagentRepository } from './infrastructure/persistence/drizzle-reagent.repositories.js';
import { ReagentController } from './presentation/reagent.controllers.js';
import {
  DrizzleImagingReadRepository,
  DrizzleImagingRepository,
} from './infrastructure/persistence/drizzle-imaging.repositories.js';
import {
  DrizzleLabReadRepository,
  DrizzleLabRepository,
} from './infrastructure/persistence/drizzle-lab.repositories.js';
import { imagingReport, labReport, reagentUsageReport } from './infrastructure/reports/lab.reports.js';
import { ImagingController } from './presentation/imaging.controllers.js';
import { LabController } from './presentation/lab.controllers.js';

/**
 * Laboratory (old Diag sample collection, pathology results and report publishing): each lab test's parameters and
 * normal ranges; samples with lab numbers for the hospital's diagnostic bills (read through DiagnosticOrders);
 * results entered, verified by someone else, printed and handed over (step 10c); imaging studies with accession
 * numbers, reports written from templates and signed by the radiologist, whose reporting fee the hospital credits
 * through ReportingFees (step 10d); each test's reagents and films used up from the lab's store department through
 * DepartmentStock when reported (step 10e).
 */
@Module({
  controllers: [LabController, ImagingController, ReagentController],
  providers: [
    ...LAB_HANDLERS,
    ...IMAGING_HANDLERS,
    ...REAGENT_HANDLERS,
    ReagentUser,
    { provide: ReagentRepository, useClass: DrizzleReagentRepository },
    { provide: LabRepository, useClass: DrizzleLabRepository },
    { provide: LabReadRepository, useClass: DrizzleLabReadRepository },
    { provide: ImagingRepository, useClass: DrizzleImagingRepository },
    { provide: ImagingReadRepository, useClass: DrizzleImagingReadRepository },
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
    private readonly imaging: ImagingReadRepository,
    private readonly context: DbContext,
    private readonly stock: DepartmentStock,
    private readonly documents: PatientDocumentRegistry,
  ) {}

  onModuleInit(): void {
    this.reports.register(labReport(this.read, this.orders, this.organization, this.users));
    this.reports.register(imagingReport(this.imaging, this.orders, this.organization));
    this.reports.register(reagentUsageReport(this.context, this.stock));
    this.documents.register(laboratoryDocuments(this.context, this.orders));
  }
}
