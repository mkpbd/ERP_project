import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import { StaffDirectory } from '../../../shared/application/contracts/staff-directory.js';
import { AuditTrail } from '../../../shared/application/ports/audit-trail.js';
import { Clock } from '../../../shared/application/ports/clock.js';
import { TransactionManager } from '../../../shared/application/ports/transaction-manager.js';
import { ConflictError, DomainError, NotFoundError } from '../../../shared/domain/errors.js';
import { SalarySheetRepository, type SalarySheetLine } from '../domain/repositories.js';
import { joinedBy, salaryLine } from '../domain/salary-sheet.js';
import { assertPayPeriod } from '../domain/salary.js';
import { PAYROLL_MANAGE, PAYROLL_READ } from './payroll.constants.js';
import { PayrollReadRepository } from './read-models.js';
import {
  ApproveSalarySheetCommand,
  CommitSalarySheetCommand,
  GetPayslipQuery,
  GetSalarySheetQuery,
  PreviewSalarySheetQuery,
  type SalarySheetView,
} from './salary-sheet.messages.js';

const byDepartment = (a: SalarySheetLine, b: SalarySheetLine) =>
  a.department.localeCompare(b.department) || a.employeeNo.localeCompare(b.employeeNo);

/** Works out a month's lines: active staff with a salary who joined by the end of the month. */
@Injectable()
export class SalarySheetBuilder {
  constructor(
    private readonly sheets: SalarySheetRepository,
    private readonly staff: StaffDirectory,
  ) {}

  async lines(year: number, month: number): Promise<SalarySheetLine[]> {
    const facts = await this.sheets.facts(year, month);
    const people = new Map(
      (await this.staff.findSummaries(facts.map((fact) => fact.staffId))).map((person) => [person.id, person]),
    );
    return facts
      .flatMap((fact) => {
        const person = people.get(fact.staffId);
        if (!person || person.status !== 'active' || !joinedBy(person.joiningDate, year, month)) return [];
        const amounts = salaryLine(
          { ...fact, joiningDate: person.joiningDate, festivalBonus: 0, incomeTax: 0 },
          year,
          month,
        );
        return [
          {
            staffId: person.id,
            employeeNo: person.employeeNo,
            fullName: person.fullName,
            departmentId: person.departmentId,
            department: person.department,
            designation: person.designation,
            joiningDate: person.joiningDate,
            paymentMode: person.paymentMode,
            bankAccountNo: person.bankAccountNo,
            ...amounts,
          },
        ];
      })
      .sort(byDepartment);
  }
}

@QueryHandler(PreviewSalarySheetQuery)
export class PreviewSalarySheetHandler implements IQueryHandler<PreviewSalarySheetQuery> {
  constructor(
    private readonly builder: SalarySheetBuilder,
    private readonly read: PayrollReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, year, month, departmentId }: PreviewSalarySheetQuery): Promise<SalarySheetView> {
    assertPayPeriod(year, month);
    await this.access.authorize(actor.userId, { permissions: [PAYROLL_READ] });
    const [lines, saved] = await Promise.all([this.builder.lines(year, month), this.read.savedSheet(year, month)]);
    return {
      year,
      month,
      status: saved?.status ?? null,
      approvedAt: saved?.approvedAt ?? null,
      committedAt: saved?.committedAt ?? null,
      lines: departmentId ? lines.filter((line) => line.departmentId === departmentId) : lines,
    };
  }
}

@QueryHandler(GetSalarySheetQuery)
export class GetSalarySheetHandler implements IQueryHandler<GetSalarySheetQuery> {
  constructor(
    private readonly read: PayrollReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, year, month, departmentId }: GetSalarySheetQuery): Promise<SalarySheetView> {
    assertPayPeriod(year, month);
    await this.access.authorize(actor.userId, { permissions: [PAYROLL_READ] });
    const saved = await this.read.savedSheet(year, month);
    if (!saved) throw new NotFoundError('salary_sheet');
    return {
      year,
      month,
      ...saved,
      lines: departmentId ? saved.lines.filter((line) => line.departmentId === departmentId) : saved.lines,
    };
  }
}

/** Saves the month's sheet as worked out now; approving again replaces it until it is committed. */
@CommandHandler(ApproveSalarySheetCommand)
export class ApproveSalarySheetHandler implements ICommandHandler<ApproveSalarySheetCommand> {
  constructor(
    private readonly builder: SalarySheetBuilder,
    private readonly sheets: SalarySheetRepository,
    private readonly access: AccessControl,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async execute({ actor, year, month }: ApproveSalarySheetCommand): Promise<{ lines: number; netPayable: number }> {
    assertPayPeriod(year, month);
    await this.access.authorize(actor.userId, { permissions: [PAYROLL_MANAGE] });
    return this.tx.run(async () => {
      await this.tx.lock(`payroll:sheet:${year}-${month}`);
      const current = await this.sheets.lock(year, month);
      if (current?.status === 'committed') {
        throw new ConflictError('salary_sheet_committed', 'The salary sheet of this month is committed');
      }
      const lines = await this.builder.lines(year, month);
      if (lines.length === 0) throw new DomainError('empty_salary_sheet', 'Nobody has a salary for this month');
      const now = this.clock.now();
      await this.sheets.saveApproved(
        { id: current?.id ?? randomUUID(), year, month, approvedBy: actor.userId, approvedAt: now },
        lines,
      );
      const netPayable = lines.reduce((sum, line) => sum + line.netPayable, 0);
      await this.audit.record({
        action: current ? 'payroll.salary_sheet_reapproved' : 'payroll.salary_sheet_approved',
        actorUserId: actor.userId,
        resourceType: 'salary_sheet',
        resourceId: `${year}-${String(month).padStart(2, '0')}`,
        metadata: { lines: lines.length, netPayable },
      });
      return { lines: lines.length, netPayable };
    });
  }
}

/** Makes the approved sheet final: it and the month's inputs can no longer change. */
@CommandHandler(CommitSalarySheetCommand)
export class CommitSalarySheetHandler implements ICommandHandler<CommitSalarySheetCommand> {
  constructor(
    private readonly sheets: SalarySheetRepository,
    private readonly access: AccessControl,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async execute({ actor, year, month }: CommitSalarySheetCommand): Promise<void> {
    assertPayPeriod(year, month);
    await this.access.authorize(actor.userId, { permissions: [PAYROLL_MANAGE] });
    await this.tx.run(async () => {
      await this.tx.lock(`payroll:sheet:${year}-${month}`);
      const sheet = await this.sheets.lock(year, month);
      if (!sheet) throw new DomainError('salary_sheet_not_approved', 'Approve the salary sheet first');
      if (sheet.status === 'committed') {
        throw new ConflictError('salary_sheet_committed', 'The salary sheet of this month is already committed');
      }
      await this.sheets.commit(sheet.id, actor.userId, this.clock.now());
      await this.audit.record({
        action: 'payroll.salary_sheet_committed',
        actorUserId: actor.userId,
        resourceType: 'salary_sheet',
        resourceId: `${year}-${String(month).padStart(2, '0')}`,
      });
    });
  }
}

/** payroll:read, or your own payslip through your linked staff record. */
@QueryHandler(GetPayslipQuery)
export class GetPayslipHandler implements IQueryHandler<GetPayslipQuery> {
  constructor(
    private readonly read: PayrollReadRepository,
    private readonly staff: StaffDirectory,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, year, month, staffId }: GetPayslipQuery): Promise<SalarySheetLine> {
    assertPayPeriod(year, month);
    const own = await this.staff.staffIdForUser(actor.userId);
    const target = staffId ?? own;
    if (!target) throw new NotFoundError('staff');
    if (target !== own) await this.access.authorize(actor.userId, { permissions: [PAYROLL_READ] });
    const line = await this.read.sheetLine(year, month, target);
    if (!line) throw new NotFoundError('payslip');
    return line;
  }
}

export const SALARY_SHEET_HANDLERS = [
  PreviewSalarySheetHandler,
  GetSalarySheetHandler,
  ApproveSalarySheetHandler,
  CommitSalarySheetHandler,
  GetPayslipHandler,
];
