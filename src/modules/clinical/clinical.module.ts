import { Module, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/configuration.js';
import { OrganizationProfile } from '../../shared/application/contracts/organization-profile.js';
import { ReportRegistry } from '../../shared/application/reports.js';
import { ClinicDesk, RX_HANDLERS } from './application/rx.handlers.js';
import { CLINICAL_SETTINGS, ClinicalReadRepository } from './application/rx.messages.js';
import { ClinicalRepository } from './domain/repositories.js';
import {
  DrizzleClinicalReadRepository,
  DrizzleClinicalRepository,
} from './infrastructure/persistence/drizzle-clinical.repositories.js';
import { prescriptionReport } from './infrastructure/reports/rx.reports.js';
import { RxController } from './presentation/rx.controllers.js';

/**
 * Clinical records (old Rx and EMR). Prescriptions (step 11a): a visit opened from a chamber appointment (or without
 * one), vitals taken by the doctor's assistant, the doctor's findings, medicines from the pharmacy's catalogue
 * (MedicineCatalogue), tests from the diagnostic catalogue (DiagnosticOrders), advice and follow-up, signed and
 * printed; pick lists and templates of the doctor's own. Doctors, appointments and patients are read through
 * OutpatientClinic and PatientDirectory.
 */
@Module({
  controllers: [RxController],
  providers: [
    ...RX_HANDLERS,
    { provide: ClinicalRepository, useClass: DrizzleClinicalRepository },
    { provide: ClinicalReadRepository, useClass: DrizzleClinicalReadRepository },
    {
      provide: CLINICAL_SETTINGS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({ timeZone: config.reports.timeZone }),
    },
  ],
})
export class ClinicalModule implements OnModuleInit {
  constructor(
    private readonly reports: ReportRegistry,
    private readonly desk: ClinicDesk,
    private readonly organization: OrganizationProfile,
  ) {}

  onModuleInit(): void {
    this.reports.register(prescriptionReport(this.desk, this.organization));
  }
}
