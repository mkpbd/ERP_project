import { Module, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/configuration.js';
import { LocationDirectory } from '../../shared/application/contracts/location-directory.js';
import { ReportRegistry } from '../../shared/application/reports.js';
import { HOSPITAL_SETTINGS, PATIENT_HANDLERS } from './application/patient.handlers.js';
import { PatientReadRepository } from './application/patient.messages.js';
import { PatientRepository } from './domain/repositories.js';
import {
  DrizzlePatientReadRepository,
  DrizzlePatientRepository,
} from './infrastructure/persistence/drizzle-patient.repositories.js';
import { patientCardReport, patientRegisterReport } from './infrastructure/reports/patient.reports.js';
import { PATIENT_CONTROLLERS } from './presentation/patient.controllers.js';

/**
 * Hospital (old Hospital area): patient registration with the UHID kept for every visit (step 9a). OPD, billing and
 * admissions follow in later steps.
 */
@Module({
  controllers: [...PATIENT_CONTROLLERS],
  providers: [
    ...PATIENT_HANDLERS,
    { provide: PatientRepository, useClass: DrizzlePatientRepository },
    { provide: PatientReadRepository, useClass: DrizzlePatientReadRepository },
    {
      provide: HOSPITAL_SETTINGS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({ timeZone: config.reports.timeZone }),
    },
  ],
})
export class HospitalModule implements OnModuleInit {
  constructor(
    private readonly reports: ReportRegistry,
    private readonly read: PatientReadRepository,
    private readonly locations: LocationDirectory,
  ) {}

  onModuleInit(): void {
    this.reports.register(patientCardReport(this.read));
    this.reports.register(patientRegisterReport(this.read, this.locations));
  }
}
