import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { DbContext } from '../../database/drizzle-transaction-manager.js';
import { AccessControl } from '../../shared/application/contracts/access-control.js';
import { StaffDirectory } from '../../shared/application/contracts/staff-directory.js';
import { StaffLedger } from '../../shared/application/contracts/staff-ledger.js';
import { RecordTypeRegistry } from '../../shared/application/records.js';
import { ReportRegistry } from '../../shared/application/reports.js';
import { BONUS_HANDLERS, BonusCalculator } from './application/bonus.handlers.js';
import { INCOME_TAX_HANDLERS } from './application/income-tax.handlers.js';
import { LEDGER_HANDLERS, PfInterestCalculator } from './application/ledger.handlers.js';
import { PayrollReadRepository } from './application/read-models.js';
import { SALARY_SHEET_HANDLERS, SalarySheetBuilder } from './application/salary-sheet.handlers.js';
import { SALARY_HANDLERS, SalaryChanges } from './application/salary.handlers.js';
import {
  FestivalBonusRepository,
  IncomeTaxRepository,
  LeaveEncashmentRepository,
  PayPeriods,
  PfLedgerRepository,
  SalaryIncrementRepository,
  SalaryPolicyRepository,
  SalarySheetRepository,
  StaffDueRepository,
  StaffSalaryRepository,
} from './domain/repositories.js';
import {
  DrizzlePayPeriods,
  DrizzleSalarySheetRepository,
} from './infrastructure/persistence/drizzle-salary-sheet.repositories.js';
import { monthlyInputRecordTypes } from './infrastructure/persistence/monthly-input.record-stores.js';
import { bonusRecordTypes } from './infrastructure/persistence/bonus.record-stores.js';
import { DrizzleIncomeTaxRepository } from './infrastructure/persistence/drizzle-income-tax.repositories.js';
import { incomeTaxRecordTypes } from './infrastructure/persistence/income-tax.record-stores.js';
import { taxCertificateReport, taxMonthlyReport } from './infrastructure/reports/income-tax.reports.js';
import { pfInterestReport, pfSettlementReport } from './infrastructure/reports/pf.reports.js';
import {
  IncomeTaxController,
  TaxCertificatesController,
  TaxYearsController,
  TaxChallansController,
} from './presentation/income-tax.controllers.js';
import {
  DrizzleFestivalBonusRepository,
  DrizzleLeaveEncashmentRepository,
  DrizzlePfLedgerRepository,
} from './infrastructure/persistence/drizzle-bonus.repositories.js';
import {
  duesStatementReport,
  festivalBonusReport,
  leaveEncashmentReport,
  pfMonthlyReport,
  pfStatementReport,
} from './infrastructure/reports/bonus.reports.js';
import {
  FestivalBonusesController,
  FestivalBonusSheetController,
  LeaveEncashmentsController,
  LedgerStatementsController,
  PfFundController,
  PfLedgerController,
  StaffDueRecoveryController,
  StaffDuesController,
} from './presentation/bonus.controllers.js';
import {
  departmentSummaryReport,
  payslipReport,
  salaryEnvelopeReport,
  salarySheetReport,
  salaryStatementReport,
} from './infrastructure/reports/sheet.reports.js';
import {
  AllowancePaymentsController,
  ArrearsController,
  DeductionsController,
  OvertimesController,
  PunishmentsController,
  SalaryPaymentsController,
  SalarySheetsController,
  SalaryStopsController,
} from './presentation/salary-sheet.controllers.js';
import {
  DrizzlePayrollReadRepository,
  DrizzleSalaryIncrementRepository,
  DrizzleSalaryPolicyRepository,
  DrizzleStaffSalaryRepository,
} from './infrastructure/persistence/drizzle-salary.repositories.js';
import { DrizzleStaffDueRepository, DrizzleStaffLedger } from './infrastructure/persistence/drizzle-staff-dues.js';
import { payrollRecordTypes } from './infrastructure/persistence/payroll.record-stores.js';
import { incrementStatementReport, salaryStructureReport } from './infrastructure/reports/salary.reports.js';
import {
  IncrementsController,
  SalariesController,
  SalaryPoliciesController,
  SalaryReviewCyclesController,
} from './presentation/payroll.controllers.js';

/**
 * Payroll: salary policies, each person's salary structure and yearly increments (step 5a);
 * monthly inputs, the salary sheet with approval and commit, payslips and payment statements (step 5b);
 * festival bonuses, leave encashment, the PF ledger and staff dues (step 5c);
 * income tax: tax years and slabs, monthly deductions, certificates (step 5d); staff dues recovered from salary
 * (step 15d). Global: it publishes the staff ledger other units sell to staff on credit through (StaffLedger).
 */
@Global()
@Module({
  controllers: [
    SalaryPoliciesController,
    SalaryReviewCyclesController,
    SalariesController,
    IncrementsController,
    OvertimesController,
    DeductionsController,
    PunishmentsController,
    ArrearsController,
    AllowancePaymentsController,
    SalaryPaymentsController,
    SalaryStopsController,
    SalarySheetsController,
    FestivalBonusesController,
    FestivalBonusSheetController,
    LeaveEncashmentsController,
    PfLedgerController,
    PfFundController,
    StaffDuesController,
    StaffDueRecoveryController,
    LedgerStatementsController,
    TaxYearsController,
    TaxChallansController,
    IncomeTaxController,
    TaxCertificatesController,
  ],
  providers: [
    ...SALARY_HANDLERS,
    ...SALARY_SHEET_HANDLERS,
    ...BONUS_HANDLERS,
    ...LEDGER_HANDLERS,
    ...INCOME_TAX_HANDLERS,
    { provide: IncomeTaxRepository, useClass: DrizzleIncomeTaxRepository },
    BonusCalculator,
    { provide: FestivalBonusRepository, useClass: DrizzleFestivalBonusRepository },
    { provide: LeaveEncashmentRepository, useClass: DrizzleLeaveEncashmentRepository },
    PfInterestCalculator,
    { provide: PfLedgerRepository, useClass: DrizzlePfLedgerRepository },
    SalaryChanges,
    SalarySheetBuilder,
    { provide: SalarySheetRepository, useClass: DrizzleSalarySheetRepository },
    { provide: PayPeriods, useClass: DrizzlePayPeriods },
    { provide: StaffSalaryRepository, useClass: DrizzleStaffSalaryRepository },
    { provide: SalaryPolicyRepository, useClass: DrizzleSalaryPolicyRepository },
    { provide: SalaryIncrementRepository, useClass: DrizzleSalaryIncrementRepository },
    { provide: PayrollReadRepository, useClass: DrizzlePayrollReadRepository },
    { provide: StaffLedger, useClass: DrizzleStaffLedger },
    { provide: StaffDueRepository, useClass: DrizzleStaffDueRepository },
  ],
  exports: [StaffLedger],
})
export class PayrollModule implements OnModuleInit {
  constructor(
    private readonly records: RecordTypeRegistry,
    private readonly reports: ReportRegistry,
    private readonly context: DbContext,
    private readonly staff: StaffDirectory,
    private readonly read: PayrollReadRepository,
    private readonly builder: SalarySheetBuilder,
    private readonly access: AccessControl,
    private readonly bonuses: BonusCalculator,
    private readonly taxes: IncomeTaxRepository,
    private readonly pfInterest: PfInterestCalculator,
  ) {}

  onModuleInit(): void {
    for (const type of [
      ...payrollRecordTypes(this.context),
      ...monthlyInputRecordTypes(this.context),
      ...bonusRecordTypes(this.context),
      ...incomeTaxRecordTypes(this.context),
    ]) {
      this.records.register(type);
    }
    this.reports.register(salaryStructureReport(this.context, this.staff));
    this.reports.register(incrementStatementReport(this.context, this.staff));
    this.reports.register(salarySheetReport(this.read, this.builder));
    this.reports.register(payslipReport(this.read, this.staff, this.access));
    this.reports.register(salaryStatementReport(this.read));
    this.reports.register(departmentSummaryReport(this.read));
    this.reports.register(salaryEnvelopeReport(this.read));
    this.reports.register(festivalBonusReport(this.read, this.bonuses));
    this.reports.register(leaveEncashmentReport(this.read));
    this.reports.register(pfMonthlyReport(this.read));
    this.reports.register(pfStatementReport(this.read, this.staff, this.access));
    this.reports.register(duesStatementReport(this.read, this.staff, this.access));
    this.reports.register(taxCertificateReport(this.taxes, this.staff, this.access));
    this.reports.register(taxMonthlyReport(this.read));
    this.reports.register(pfSettlementReport(this.read, this.staff, this.access));
    this.reports.register(pfInterestReport(this.pfInterest));
  }
}
