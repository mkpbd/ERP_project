import { Command, CommandHandler, Query, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import { StaffDirectory, type StaffSummary } from '../../../shared/application/contracts/staff-directory.js';
import { AuditTrail } from '../../../shared/application/ports/audit-trail.js';
import { Clock } from '../../../shared/application/ports/clock.js';
import { TransactionManager } from '../../../shared/application/ports/transaction-manager.js';
import { ConflictError, DomainError, NotFoundError } from '../../../shared/domain/errors.js';
import { incomeTaxCertificate, type IncomeTaxCertificate } from '../domain/income-tax.js';
import { IncomeTaxRepository, PayPeriods, type IncomeTaxDeduction, type TaxYear } from '../domain/repositories.js';
import { assertPayPeriod } from '../domain/salary.js';
import { PAYROLL_MANAGE, PAYROLL_READ } from './payroll.constants.js';
import { PayrollReadRepository } from './read-models.js';

const firstDay = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}-01`;

export interface IncomeTaxDeductionView extends IncomeTaxDeduction {
  readonly employeeNo: string;
  readonly fullName: string;
  readonly department: string;
}

export interface TaxCertificateView {
  readonly staff: StaffSummary;
  readonly taxYear: { readonly id: string; readonly label: string; readonly startsOn: string; readonly endsOn: string };
  readonly certificate: IncomeTaxCertificate;
}

/** Works out every salaried person's tax deduction for a pay month (deductions entered by hand are kept). */
export class ComputeIncomeTaxCommand extends Command<{ people: number; monthlyTax: number }> {
  constructor(
    readonly actor: Actor,
    readonly year: number,
    readonly month: number,
  ) {
    super();
  }
}

/** Enters a person's tax deduction for a pay month by hand (old TaxAdjustmentListOfMay); null removes it. */
export class SetIncomeTaxCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly year: number,
    readonly month: number,
    readonly staffId: string,
    readonly monthlyTax: number | null,
    readonly remarks: string | null,
  ) {
    super();
  }
}

export class ListIncomeTaxQuery extends Query<IncomeTaxDeductionView[]> {
  constructor(
    readonly actor: Actor,
    readonly year: number,
    readonly month: number,
  ) {
    super();
  }
}

/** Without a staff id: the actor's own certificate. */
export class GetTaxCertificateQuery extends Query<TaxCertificateView> {
  constructor(
    readonly actor: Actor,
    readonly taxYearId: string,
    readonly staffId?: string,
  ) {
    super();
  }
}

async function taxYearOf(taxes: IncomeTaxRepository, year: number, month: number): Promise<TaxYear> {
  const taxYear = await taxes.taxYearOn(firstDay(year, month));
  if (!taxYear) {
    throw new DomainError('income_tax_year_missing', `Set up the tax year that covers ${firstDay(year, month)} first`);
  }
  return taxYear;
}

async function assertOpen(periods: PayPeriods, year: number, month: number): Promise<void> {
  if (await periods.isClosed(year, month)) {
    throw new ConflictError('pay_period_closed', 'The salary sheet of this month is committed');
  }
}

@CommandHandler(ComputeIncomeTaxCommand)
export class ComputeIncomeTaxHandler implements ICommandHandler<ComputeIncomeTaxCommand> {
  constructor(
    private readonly taxes: IncomeTaxRepository,
    private readonly periods: PayPeriods,
    private readonly staff: StaffDirectory,
    private readonly access: AccessControl,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async execute({ actor, year, month }: ComputeIncomeTaxCommand): Promise<{ people: number; monthlyTax: number }> {
    assertPayPeriod(year, month);
    await this.access.authorize(actor.userId, { permissions: [PAYROLL_MANAGE] });
    return this.tx.run(async () => {
      await this.tx.lock(`payroll:income-tax:${year}-${month}`);
      await assertOpen(this.periods, year, month);
      const taxYear = await taxYearOf(this.taxes, year, month);
      const facts = await this.taxes.facts(taxYear.startsOn, taxYear.endsOn);
      const people = new Map(
        (await this.staff.findSummaries(facts.map((fact) => fact.staffId))).map((person) => [person.id, person]),
      );
      const rows = facts.flatMap((fact): IncomeTaxDeduction[] => {
        const person = people.get(fact.staffId);
        if (!person || person.status !== 'active') return [];
        const certificate = incomeTaxCertificate(
          { ...fact, joiningDate: person.joiningDate, sex: person.sex },
          taxYear,
        );
        return [
          {
            staffId: fact.staffId,
            payYear: year,
            payMonth: month,
            taxYearId: taxYear.id,
            taxableIncome: certificate.taxableIncome,
            yearlyTax: certificate.netTax,
            monthlyTax: certificate.monthlyTax,
            source: 'computed',
            remarks: null,
          },
        ];
      });
      await this.taxes.replaceComputed(year, month, rows, actor.userId, this.clock.now());
      const result = { people: rows.length, monthlyTax: rows.reduce((sum, row) => sum + row.monthlyTax, 0) };
      await this.audit.record({
        action: 'payroll.income_tax_computed',
        actorUserId: actor.userId,
        resourceType: 'income_tax',
        resourceId: `${year}-${String(month).padStart(2, '0')}`,
        metadata: { ...result, taxYear: taxYear.label },
      });
      return result;
    });
  }
}

@CommandHandler(SetIncomeTaxCommand)
export class SetIncomeTaxHandler implements ICommandHandler<SetIncomeTaxCommand> {
  constructor(
    private readonly taxes: IncomeTaxRepository,
    private readonly periods: PayPeriods,
    private readonly staff: StaffDirectory,
    private readonly access: AccessControl,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async execute({ actor, year, month, staffId, monthlyTax, remarks }: SetIncomeTaxCommand): Promise<void> {
    assertPayPeriod(year, month);
    await this.access.authorize(actor.userId, { permissions: [PAYROLL_MANAGE] });
    await this.tx.run(async () => {
      await this.tx.lock(`payroll:income-tax:${year}-${month}`);
      await assertOpen(this.periods, year, month);
      const [person] = await this.staff.findSummaries([staffId]);
      if (!person) throw new NotFoundError('staff');
      if (monthlyTax === null) {
        if (!(await this.taxes.removeManual(staffId, year, month))) throw new NotFoundError('income_tax_override');
      } else {
        const taxYear = await taxYearOf(this.taxes, year, month);
        await this.taxes.setManual(
          {
            staffId,
            payYear: year,
            payMonth: month,
            taxYearId: taxYear.id,
            taxableIncome: null,
            yearlyTax: null,
            monthlyTax,
            source: 'manual',
            remarks,
          },
          actor.userId,
          this.clock.now(),
        );
      }
      await this.audit.record({
        action: monthlyTax === null ? 'payroll.income_tax_override_removed' : 'payroll.income_tax_overridden',
        actorUserId: actor.userId,
        resourceType: 'income_tax',
        resourceId: `${year}-${String(month).padStart(2, '0')}`,
        metadata: { staffId, monthlyTax },
      });
    });
  }
}

@QueryHandler(ListIncomeTaxQuery)
export class ListIncomeTaxHandler implements IQueryHandler<ListIncomeTaxQuery> {
  constructor(
    private readonly read: PayrollReadRepository,
    private readonly staff: StaffDirectory,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, year, month }: ListIncomeTaxQuery): Promise<IncomeTaxDeductionView[]> {
    assertPayPeriod(year, month);
    await this.access.authorize(actor.userId, { permissions: [PAYROLL_READ] });
    const rows = await this.read.incomeTaxDeductions(year, month);
    const people = new Map(
      (await this.staff.findSummaries(rows.map((row) => row.staffId))).map((person) => [person.id, person]),
    );
    return rows
      .flatMap((row) => {
        const person = people.get(row.staffId);
        return person
          ? [{ ...row, employeeNo: person.employeeNo, fullName: person.fullName, department: person.department }]
          : [];
      })
      .sort((a, b) => a.employeeNo.localeCompare(b.employeeNo));
  }
}

/** The certificate of a tax year so far; payroll:read, or your own through your linked staff record. */
@QueryHandler(GetTaxCertificateQuery)
export class GetTaxCertificateHandler implements IQueryHandler<GetTaxCertificateQuery> {
  constructor(
    private readonly taxes: IncomeTaxRepository,
    private readonly staff: StaffDirectory,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, taxYearId, staffId }: GetTaxCertificateQuery): Promise<TaxCertificateView> {
    const own = await this.staff.staffIdForUser(actor.userId);
    const target = staffId ?? own;
    if (!target) throw new NotFoundError('staff');
    if (target !== own) await this.access.authorize(actor.userId, { permissions: [PAYROLL_READ] });
    return taxCertificate(this.taxes, this.staff, taxYearId, target);
  }
}

/** Shared by the query and the certificate report. */
export async function taxCertificate(
  taxes: IncomeTaxRepository,
  staff: StaffDirectory,
  taxYearId: string,
  staffId: string,
): Promise<TaxCertificateView> {
  const [taxYear, [person]] = await Promise.all([taxes.taxYear(taxYearId), staff.findSummaries([staffId])]);
  if (!taxYear) throw new NotFoundError('income_tax_year');
  if (!person) throw new NotFoundError('staff');
  const [fact] = await taxes.facts(taxYear.startsOn, taxYear.endsOn, [staffId]);
  if (!fact) throw new NotFoundError('staff_salary');
  return {
    staff: person,
    taxYear: { id: taxYear.id, label: taxYear.label, startsOn: taxYear.startsOn, endsOn: taxYear.endsOn },
    certificate: incomeTaxCertificate({ ...fact, joiningDate: person.joiningDate, sex: person.sex }, taxYear),
  };
}

export const INCOME_TAX_HANDLERS = [
  ComputeIncomeTaxHandler,
  SetIncomeTaxHandler,
  ListIncomeTaxHandler,
  GetTaxCertificateHandler,
];
