import { Module, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/configuration.js';
import { DbContext } from '../../database/drizzle-transaction-manager.js';
import { OrganizationProfile } from '../../shared/application/contracts/organization-profile.js';
import { RecordTypeRegistry } from '../../shared/application/records.js';
import { ReportRegistry } from '../../shared/application/reports.js';
import { EmrDesk, EMR_HANDLERS } from './application/emr.handlers.js';
import { EmrReadRepository } from './application/emr.messages.js';
import { ClinicDesk, RX_HANDLERS } from './application/rx.handlers.js';
import { CLINICAL_SETTINGS, ClinicalReadRepository } from './application/rx.messages.js';
import { ClinicalRepository, EmrRepository } from './domain/repositories.js';
import { clinicalRecordTypes } from './infrastructure/persistence/clinical.record-stores.js';
import {
  DrizzleEmrReadRepository,
  DrizzleEmrRepository,
} from './infrastructure/persistence/drizzle-emr.repositories.js';
import {
  DrizzleClinicalReadRepository,
  DrizzleClinicalRepository,
} from './infrastructure/persistence/drizzle-clinical.repositories.js';
import {
  birthCertificateReport,
  caseNotesReport,
  deathCertificateReport,
} from './infrastructure/reports/emr.reports.js';
import { prescriptionReport } from './infrastructure/reports/rx.reports.js';
import { EMR_CONTROLLERS } from './presentation/emr.controllers.js';
import { RxController } from './presentation/rx.controllers.js';

/**
 * Clinical records (old Rx and EMR). Prescriptions (step 11a): a visit opened from a chamber appointment (or without
 * one), vitals taken by the doctor's assistant, the doctor's findings, medicines from the pharmacy's catalogue
 * (MedicineCatalogue), tests from the diagnostic catalogue (DiagnosticOrders), advice and follow-up, signed and
 * printed; pick lists and templates of the doctor's own. Doctors, appointments and patients are read through
 * OutpatientClinic and PatientDirectory. EMR (step 11b): notes on admitted patients (rounds, consultations, procedures,
 * transfers, ICU course, handovers acknowledged by the nurse taking over), note templates, death and birth records
 * with their certificates; admissions are read through InpatientRegister.
 */
@Module({
  controllers: [RxController, ...EMR_CONTROLLERS],
  providers: [
    ...RX_HANDLERS,
    ...EMR_HANDLERS,
    { provide: EmrRepository, useClass: DrizzleEmrRepository },
    { provide: EmrReadRepository, useClass: DrizzleEmrReadRepository },
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
    private readonly records: RecordTypeRegistry,
    private readonly reports: ReportRegistry,
    private readonly context: DbContext,
    private readonly desk: ClinicDesk,
    private readonly emr: EmrDesk,
    private readonly organization: OrganizationProfile,
  ) {}

  onModuleInit(): void {
    for (const type of clinicalRecordTypes(this.context)) this.records.register(type);
    this.reports.register(prescriptionReport(this.desk, this.organization));
    this.reports.register(caseNotesReport(this.emr, this.organization));
    this.reports.register(deathCertificateReport(this.emr, this.organization));
    this.reports.register(birthCertificateReport(this.emr, this.organization));
  }
}
