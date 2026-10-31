import { Global, Inject, Module, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/configuration.js';
import { DiagnosticOrders } from '../../shared/application/contracts/diagnostic-orders.js';
import { InpatientRegister } from '../../shared/application/contracts/inpatient-register.js';
import { PatientDirectory } from '../../shared/application/contracts/patient-directory.js';
import { OutpatientClinic } from '../../shared/application/contracts/outpatient-clinic.js';
import { ReferredBilling } from '../../shared/application/contracts/referred-billing.js';
import { DrizzleReferredBilling } from './infrastructure/persistence/drizzle-referred-billing.js';
import { DrizzleOutpatientClinic } from './infrastructure/persistence/drizzle-outpatient-clinic.js';
import { DrizzlePatientDirectory } from './infrastructure/persistence/drizzle-patient-directory.js';
import { ReportingFees } from '../../shared/application/contracts/reporting-fees.js';
import { HospitalReportingFees } from './application/reporting-fees.js';
import { LocationDirectory } from '../../shared/application/contracts/location-directory.js';
import { OrganizationProfile } from '../../shared/application/contracts/organization-profile.js';
import { DbContext } from '../../database/drizzle-transaction-manager.js';
import { RecordTypeRegistry } from '../../shared/application/records.js';
import { ReportRegistry } from '../../shared/application/reports.js';
import { StaffDirectory } from '../../shared/application/contracts/staff-directory.js';
import { UserDirectory } from '../../shared/application/contracts/user-directory.js';
import { APPOINTMENT_HANDLERS } from './application/appointment.handlers.js';
import { DIAGNOSTIC_HANDLERS } from './application/diagnostic.handlers.js';
import { DiagnosticBillReadRepository } from './application/diagnostic.messages.js';
import { IPD_BILLING_HANDLERS, IpdCashier } from './application/ipd-billing.handlers.js';
import { IpdBillingReadRepository } from './application/ipd-billing.messages.js';
import { IPD_HANDLERS } from './application/ipd.handlers.js';
import { OT_HANDLERS } from './application/ot.handlers.js';
import { VISITOR_HANDLERS } from './application/visitor.handlers.js';
import { VisitorPassReadRepository } from './application/visitor.messages.js';
import { OtReadRepository } from './application/ot.messages.js';
import { AdmissionReadRepository } from './application/ipd.messages.js';
import { OPD_HANDLERS } from './application/opd.handlers.js';
import { OpdBillReadRepository } from './application/opd.messages.js';
import { AppointmentReadRepository } from './application/appointment.messages.js';
import { HOSPITAL_SETTINGS, PATIENT_HANDLERS, type HospitalSettings } from './application/patient.handlers.js';
import { PatientDocumentRegistry } from '../../shared/application/patient-documents.js';
import { hospitalDocuments } from './infrastructure/persistence/hospital.patient-documents.js';
import { PatientReadRepository } from './application/patient.messages.js';
import {
  AdmissionRepository,
  AppointmentRepository,
  DiagnosticBillRepository,
  IpdBillingRepository,
  OtCaseRepository,
  VisitorPassRepository,
  OpdBillRepository,
  PatientRepository,
} from './domain/repositories.js';
import {
  DrizzleDiagnosticBillReadRepository,
  DrizzleDiagnosticBillRepository,
} from './infrastructure/persistence/drizzle-diagnostic.repositories.js';
import {
  diagnosticIncomeReport,
  diagnosticReceiptReport,
  referralCommissionReport,
} from './infrastructure/reports/diagnostic.reports.js';
import { DIAGNOSTIC_CONTROLLERS } from './presentation/diagnostic.controllers.js';
import { DrizzleDiagnosticOrders } from './infrastructure/persistence/drizzle-diagnostic-orders.js';
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
import { OT_CONTROLLERS } from './presentation/ot.controllers.js';
import { VisitorPassesController } from './presentation/visitor.controllers.js';
import { visitorPassReport } from './infrastructure/reports/visitor.reports.js';
import {
  DrizzleVisitorPassReadRepository,
  DrizzleVisitorPassRepository,
} from './infrastructure/persistence/drizzle-visitor.repositories.js';
import { otConsentReport, otNoteReport, otRegisterReport } from './infrastructure/reports/ot.reports.js';
import {
  DrizzleOtCaseRepository,
  DrizzleOtReadRepository,
} from './infrastructure/persistence/drizzle-ot.repositories.js';
import { ipdBillReport, ipdCollectionReport, ipdReceiptReport } from './infrastructure/reports/ipd-billing.reports.js';
import {
  DrizzleOpdBillReadRepository,
  DrizzleOpdBillRepository,
} from './infrastructure/persistence/drizzle-opd.repositories.js';
import {
  corporateStatementReport,
  diagnosticCollectionReport,
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
 * across OPD and indoor bills, statements and the UHID merge (step 9g); the test catalogue and diagnostic bills with
 * the referring doctors' commission (step 10a); admitted patients' tests on the indoor bill and diagnostic bills in
 * the statements (step 10b). Global: it publishes the admissions other
 * modules charge to (InpatientRegister), for the pharmacy's ward medicine, and the diagnostic bills the lab works
 * from (DiagnosticOrders), the reporting doctors' fees it credits (ReportingFees) and the patients (PatientDirectory).
 */
@Global()
@Module({
  controllers: [
    ...PATIENT_CONTROLLERS,
    ...DOCTOR_CONTROLLERS,
    ...APPOINTMENT_CONTROLLERS,
    ...OPD_CONTROLLERS,
    ...IPD_CONTROLLERS,
    ...OT_CONTROLLERS,
    VisitorPassesController,
    ...IPD_BILLING_CONTROLLERS,
    ...DIAGNOSTIC_CONTROLLERS,
  ],
  providers: [
    ...PATIENT_HANDLERS,
    ...APPOINTMENT_HANDLERS,
    ...OPD_HANDLERS,
    ...IPD_HANDLERS,
    ...OT_HANDLERS,
    ...VISITOR_HANDLERS,
    ...IPD_BILLING_HANDLERS,
    ...DIAGNOSTIC_HANDLERS,
    { provide: PatientRepository, useClass: DrizzlePatientRepository },
    { provide: PatientReadRepository, useClass: DrizzlePatientReadRepository },
    { provide: AppointmentRepository, useClass: DrizzleAppointmentRepository },
    { provide: AppointmentReadRepository, useClass: DrizzleAppointmentReadRepository },
    { provide: OpdBillRepository, useClass: DrizzleOpdBillRepository },
    { provide: OpdBillReadRepository, useClass: DrizzleOpdBillReadRepository },
    { provide: AdmissionRepository, useClass: DrizzleAdmissionRepository },
    { provide: AdmissionReadRepository, useClass: DrizzleAdmissionReadRepository },
    { provide: IpdBillingRepository, useClass: DrizzleIpdBillingRepository },
    { provide: OtCaseRepository, useClass: DrizzleOtCaseRepository },
    { provide: OtReadRepository, useClass: DrizzleOtReadRepository },
    { provide: VisitorPassRepository, useClass: DrizzleVisitorPassRepository },
    { provide: VisitorPassReadRepository, useClass: DrizzleVisitorPassReadRepository },
    { provide: IpdBillingReadRepository, useClass: DrizzleIpdBillingReadRepository },
    { provide: InpatientRegister, useClass: DrizzleInpatientRegister },
    { provide: DiagnosticOrders, useClass: DrizzleDiagnosticOrders },
    { provide: ReportingFees, useClass: HospitalReportingFees },
    { provide: PatientDirectory, useClass: DrizzlePatientDirectory },
    { provide: OutpatientClinic, useClass: DrizzleOutpatientClinic },
    { provide: ReferredBilling, useClass: DrizzleReferredBilling },
    { provide: DiagnosticBillRepository, useClass: DrizzleDiagnosticBillRepository },
    { provide: DiagnosticBillReadRepository, useClass: DrizzleDiagnosticBillReadRepository },
    {
      provide: HOSPITAL_SETTINGS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({ timeZone: config.reports.timeZone }),
    },
  ],
  exports: [InpatientRegister, DiagnosticOrders, ReportingFees, PatientDirectory, OutpatientClinic, ReferredBilling],
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
    private readonly operations: OtReadRepository,
    private readonly visitorPasses: VisitorPassReadRepository,
    private readonly cashier: IpdCashier,
    private readonly ipdBills: IpdBillingReadRepository,
    private readonly diagnostics: DiagnosticBillReadRepository,
    private readonly documents: PatientDocumentRegistry,
    @Inject(HOSPITAL_SETTINGS) private readonly settings: HospitalSettings,
  ) {}

  onModuleInit(): void {
    for (const type of hospitalRecordTypes(this.context)) this.records.register(type);
    this.documents.register(hospitalDocuments(this.context, this.settings.timeZone));
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
    this.reports.register(otRegisterReport(this.operations));
    this.reports.register(otNoteReport(this.operations, this.organization));
    this.reports.register(otConsentReport(this.operations, this.organization));
    this.reports.register(visitorPassReport(this.visitorPasses, this.organization));
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
    this.reports.register(diagnosticReceiptReport(this.diagnostics, this.organization, this.staff));
    this.reports.register(referralCommissionReport(this.context));
    this.reports.register(diagnosticIncomeReport(this.context));
    this.reports.register(diagnosticCollectionReport(this.context, this.users));
  }
}
