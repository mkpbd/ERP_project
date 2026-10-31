import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/configuration.js';
import { DbContext } from '../../database/drizzle-transaction-manager.js';
import { OrganizationProfile } from '../../shared/application/contracts/organization-profile.js';
import { PatientDirectory } from '../../shared/application/contracts/patient-directory.js';
import { PatientDocumentRegistry } from '../../shared/application/patient-documents.js';
import { RecordTypeRegistry } from '../../shared/application/records.js';
import { clinicalDocuments } from './infrastructure/persistence/clinical.patient-documents.js';
import { ReportRegistry } from '../../shared/application/reports.js';
import { EmrDesk, EMR_HANDLERS } from './application/emr.handlers.js';
import { EmrReadRepository } from './application/emr.messages.js';
import { HISTORY_HANDLERS } from './application/history.handlers.js';
import { HistoryReadRepository } from './application/history.messages.js';
import { ClinicDesk, RX_HANDLERS } from './application/rx.handlers.js';
import { CLINICAL_SETTINGS, ClinicalReadRepository, type ClinicalSettings } from './application/rx.messages.js';
import { OBSERVATION_HANDLERS, ObservationDesk } from './application/observation.handlers.js';
import { ObservationReadRepository } from './application/observation.messages.js';
import { TREATMENT_HANDLERS, TreatmentDesk } from './application/treatment.handlers.js';
import { TreatmentReadRepository } from './application/treatment.messages.js';
import {
  ClinicalRepository,
  EmrRepository,
  ObservationRepository,
  TreatmentRepository,
} from './domain/repositories.js';
import {
  DrizzleObservationReadRepository,
  DrizzleObservationRepository,
} from './infrastructure/persistence/drizzle-observation.repositories.js';
import { observationChartReport } from './infrastructure/reports/observation.reports.js';
import { OBSERVATION_CONTROLLERS } from './presentation/observation.controllers.js';
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
import { DrizzleHistoryReadRepository } from './infrastructure/persistence/drizzle-history.repository.js';
import { historyRecordReport } from './infrastructure/reports/history.reports.js';
import { prescriptionReport } from './infrastructure/reports/rx.reports.js';
import {
  careChartReport,
  dischargeSummaryReport,
  medicationChartReport,
} from './infrastructure/reports/treatment.reports.js';
import {
  DrizzleTreatmentReadRepository,
  DrizzleTreatmentRepository,
} from './infrastructure/persistence/drizzle-treatment.repositories.js';
import { TreatmentController } from './presentation/treatment.controllers.js';
import { EMR_CONTROLLERS } from './presentation/emr.controllers.js';
import { HistoryController } from './presentation/history.controllers.js';
import { RxController } from './presentation/rx.controllers.js';

/**
 * Clinical records (old Rx and EMR). Prescriptions (step 11a): a visit opened from a chamber appointment (or without
 * one), vitals taken by the doctor's assistant, the doctor's findings, medicines from the pharmacy's catalogue
 * (MedicineCatalogue), tests from the diagnostic catalogue (DiagnosticOrders), advice and follow-up, signed and
 * printed; pick lists and templates of the doctor's own. Doctors, appointments and patients are read through
 * OutpatientClinic and PatientDirectory. EMR (step 11b): notes on admitted patients (rounds, consultations, procedures,
 * transfers, ICU course, handovers acknowledged by the nurse taking over), note templates, death and birth records
 * with their certificates; admissions are read through InpatientRegister. Treatment (step 11c): medicines ordered with
 * dose times, held, resumed and stopped; doses charted by the nurses; the discharge summary signed by the doctor.
 * History (step 13f): the old system's prescriptions, reports, discharge certificates and notes, brought over read-only.
 */
@Module({
  controllers: [RxController, ...EMR_CONTROLLERS, TreatmentController, HistoryController, ...OBSERVATION_CONTROLLERS],
  providers: [
    ...RX_HANDLERS,
    ...EMR_HANDLERS,
    ...TREATMENT_HANDLERS,
    ...OBSERVATION_HANDLERS,
    ...HISTORY_HANDLERS,
    { provide: HistoryReadRepository, useClass: DrizzleHistoryReadRepository },
    { provide: TreatmentRepository, useClass: DrizzleTreatmentRepository },
    { provide: ObservationRepository, useClass: DrizzleObservationRepository },
    { provide: ObservationReadRepository, useClass: DrizzleObservationReadRepository },
    { provide: TreatmentReadRepository, useClass: DrizzleTreatmentReadRepository },
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
    private readonly treatment: TreatmentDesk,
    private readonly observations: ObservationDesk,
    private readonly organization: OrganizationProfile,
    private readonly documents: PatientDocumentRegistry,
    private readonly history: HistoryReadRepository,
    private readonly patients: PatientDirectory,
    @Inject(CLINICAL_SETTINGS) private readonly settings: ClinicalSettings,
  ) {}

  onModuleInit(): void {
    for (const type of clinicalRecordTypes(this.context)) this.records.register(type);
    this.documents.register(clinicalDocuments(this.context, this.settings.timeZone));
    this.reports.register(prescriptionReport(this.desk, this.organization));
    this.reports.register(caseNotesReport(this.emr, this.organization));
    this.reports.register(deathCertificateReport(this.emr, this.organization));
    this.reports.register(birthCertificateReport(this.emr, this.organization));
    this.reports.register(medicationChartReport(this.treatment, this.organization));
    this.reports.register(careChartReport(this.treatment, this.organization));
    this.reports.register(observationChartReport(this.observations, this.organization));
    this.reports.register(dischargeSummaryReport(this.treatment, this.organization));
    this.reports.register(historyRecordReport(this.history, this.patients, this.organization));
  }
}
