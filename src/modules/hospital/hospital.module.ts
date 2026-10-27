import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/configuration.js';
import { InpatientRegister } from '../../shared/application/contracts/inpatient-register.js';
import { LocationDirectory } from '../../shared/application/contracts/location-directory.js';
import { OrganizationProfile } from '../../shared/application/contracts/organization-profile.js';
import { DbContext } from '../../database/drizzle-transaction-manager.js';
import { RecordTypeRegistry } from '../../shared/application/records.js';
import { ReportRegistry } from '../../shared/application/reports.js';
import { StaffDirectory } from '../../shared/application/contracts/staff-directory.js';
import { UserDirectory } from '../../shared/application/contracts/user-directory.js';
import { APPOINTMENT_HANDLERS } from './application/appointment.handlers.js';
import { IPD_BILLING_HANDLERS, IpdCashier } from './application/ipd-billing.handlers.js';
import { IpdBillingReadRepository } from './application/ipd-billing.messages.js';
import { IPD_HANDLERS } from './application/ipd.handlers.js';
import { AdmissionReadRepository } from './application/ipd.messages.js';
import { OPD_HANDLERS } from './application/opd.handlers.js';
import { OpdBillReadRepository } from './application/opd.messages.js';
import { AppointmentReadRepository } from './application/appointment.messages.js';
import { HOSPITAL_SETTINGS, PATIENT_HANDLERS } from './application/patient.handlers.js';
import { PatientReadRepository } from './application/patient.messages.js';
import {
  AdmissionRepository,
  AppointmentRepository,
  IpdBillingRepository,
  OpdBillRepository,
  PatientRepository,
} from './domain/repositories.js';
import { DrizzleInpatientRegister } from './infrastructure/persistence/drizzle-inpatient-register.js';
import {
  DrizzleIpdBillingReadRepository,
  DrizzleIpdBillingRepository,
} from './infrastructure/persistence/drizzle-ipd-billing.repositories.js';
import {
  DrizzleAdmissionReadRepository,
  DrizzleAdmissionRepository,
} from './infrastructure/persistence/drizzle-ipd.repositories.js';
import {
  admissionFormReport,
  admissionRegisterReport,
  bedOccupancyReport,
  inpatientCensusReport,
} from './infrastructure/reports/ipd.reports.js';
import {
  discountsReport,
  doctorLedgerReport,
  doctorPayablesReport,
  duesReport,
  incomeByHeadReport,
  patientStatementReport,
} from './infrastructure/reports/statement.reports.js';
import { IPD_BILLING_CONTROLLERS } from './presentation/ipd-billing.controllers.js';
import { IPD_CONTROLLERS } from './presentation/ipd.controllers.js';
import { ipdBillReport, ipdCollectionReport, ipdReceiptReport } from './infrastructure/reports/ipd-billing.reports.js';
import {
  DrizzleOpdBillReadRepository,
  DrizzleOpdBillRepository,
} from './infrastructure/persistence/drizzle-opd.repositories.js';
import {
  corporateStatementReport,
  doctorConsultationsReport,
  opdCollectionReport,
  opdReceiptReport,
  serviceIncomeReport,
} from './infrastructure/reports/opd.reports.js';
import { OPD_CONTROLLERS } from './presentation/opd.controllers.js';
import {
  DrizzleAppointmentReadRepository,
  DrizzleAppointmentRepository,
} from './infrastructure/persistence/drizzle-appointment.repositories.js';
import { hospitalRecordTypes } from './infrastructure/persistence/hospital.record-stores.js';
import { appointmentSlipReport, doctorAppointmentsReport } from './infrastructure/reports/appointment.reports.js';
import { APPOINTMENT_CONTROLLERS } from './presentation/appointment.controllers.js';
import { DOCTOR_CONTROLLERS } from './presentation/doctor.controllers.js';
import {
  DrizzlePatientReadRepository,
  DrizzlePatientRepository,
} from './infrastructure/persistence/drizzle-patient.repositories.js';
import { patientCardReport, patientRegisterReport } from './infrastructure/reports/patient.reports.js';
import { PATIENT_CONTROLLERS } from './presentation/patient.controllers.js';

/**
 * Hospital (old Hospital and OPD areas): patient registration with the UHID kept for every visit (step 9a); doctors,
 * chamber schedules and appointments (step 9b); OPD consultation billing with the doctor's share (step 9c); OPD and
 * emergency services, corporate clients and staff billing (step 9d); admissions, beds and discharge (step 9e); the
 * indoor bill: charges, advances, the final bill and its dues (step 9f); doctor payments, corporate collections
 * across OPD and indoor bills, statements and the UHID merge (step 9g). Global: it publishes the admissions other
 * modules charge to (InpatientRegister), for the pharmacy's ward medicine.
 */
@Global()
@Module({
  controllers: [
    ...PATIENT_CONTROLLERS,
    ...DOCTOR_CONTROLLERS,
    ...APPOINTMENT_CONTROLLERS,
    ...OPD_CONTROLLERS,
    ...IPD_CONTROLLERS,
    ...IPD_BILLING_CONTROLLERS,
  ],
  providers: [
    ...PATIENT_HANDLERS,
    ...APPOINTMENT_HANDLERS,
    ...OPD_HANDLERS,
    ...IPD_HANDLERS,
    ...IPD_BILLING_HANDLERS,
    { provide: PatientRepository, useClass: DrizzlePatientRepository },
    { provide: PatientReadRepository, useClass: DrizzlePatientReadRepository },
    { provide: AppointmentRepository, useClass: DrizzleAppointmentRepository },
    { provide: AppointmentReadRepository, useClass: DrizzleAppointmentReadRepository },
    { provide: OpdBillRepository, useClass: DrizzleOpdBillRepository },
    { provide: OpdBillReadRepository, useClass: DrizzleOpdBillReadRepository },
    { provide: AdmissionRepository, useClass: DrizzleAdmissionRepository },
    { provide: AdmissionReadRepository, useClass: DrizzleAdmissionReadRepository },
    { provide: IpdBillingRepository, useClass: DrizzleIpdBillingRepository },
    { provide: IpdBillingReadRepository, useClass: DrizzleIpdBillingReadRepository },
    { provide: InpatientRegister, useClass: DrizzleInpatientRegister },
    {
      provide: HOSPITAL_SETTINGS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({ timeZone: config.reports.timeZone }),
    },
  ],
  exports: [InpatientRegister],
})
export class HospitalModule implements OnModuleInit {
  constructor(
    private readonly records: RecordTypeRegistry,
    private readonly context: DbContext,
    private readonly reports: ReportRegistry,
    private readonly read: PatientReadRepository,
    private readonly locations: LocationDirectory,
    private readonly organization: OrganizationProfile,
    private readonly appointments: AppointmentReadRepository,
    private readonly bills: OpdBillReadRepository,
    private readonly users: UserDirectory,
    private readonly staff: StaffDirectory,
    private readonly admissions: AdmissionReadRepository,
    private readonly cashier: IpdCashier,
    private readonly ipdBills: IpdBillingReadRepository,
  ) {}

  onModuleInit(): void {
    for (const type of hospitalRecordTypes(this.context)) this.records.register(type);
    this.reports.register(patientCardReport(this.read, this.organization));
    this.reports.register(patientRegisterReport(this.read, this.locations, this.organization));
    this.reports.register(doctorAppointmentsReport(this.appointments, this.organization));
    this.reports.register(appointmentSlipReport(this.appointments, this.organization));
    this.reports.register(opdReceiptReport(this.bills, this.organization, this.staff));
    this.reports.register(opdCollectionReport(this.context, this.users));
    this.reports.register(doctorConsultationsReport(this.context));
    this.reports.register(corporateStatementReport(this.context));
    this.reports.register(serviceIncomeReport(this.context));
    this.reports.register(admissionFormReport(this.admissions, this.organization));
    this.reports.register(inpatientCensusReport(this.admissions));
    this.reports.register(admissionRegisterReport(this.admissions));
    this.reports.register(bedOccupancyReport(this.context));
    this.reports.register(ipdBillReport(this.cashier, this.admissions, this.organization, this.staff));
    this.reports.register(ipdReceiptReport(this.ipdBills, this.organization, this.users));
    this.reports.register(ipdCollectionReport(this.context, this.users));
    this.reports.register(doctorPayablesReport(this.context));
    this.reports.register(doctorLedgerReport(this.bills));
    this.reports.register(patientStatementReport(this.context, this.organization));
    this.reports.register(duesReport(this.context));
    this.reports.register(discountsReport(this.context, this.users));
    this.reports.register(incomeByHeadReport(this.context));
  }
}
