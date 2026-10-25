import { Injectable } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import { StaffDirectory } from '../../../shared/application/contracts/staff-directory.js';
import { AuditTrail } from '../../../shared/application/ports/audit-trail.js';
import { Clock } from '../../../shared/application/ports/clock.js';
import { TransactionManager } from '../../../shared/application/ports/transaction-manager.js';
import { ConflictError, DomainError, NotFoundError } from '../../../shared/domain/errors.js';
import { bonusBaseMonth, festivalBonusAmount, leaveEncashment } from '../domain/bonus.js';
import {
  FestivalBonusRepository,
  LeaveEncashmentRepository,
  PayPeriods,
  type FestivalBonusLine,
  type FestivalBonusSchedule,
  type LeaveEncashmentLine,
} from '../domain/repositories.js';
import { assertPayPeriod } from '../domain/salary.js';
import {
  ActOnFestivalBonusCommand,
  ApproveLeaveEncashmentCommand,
  GetFestivalBonusSheetQuery,
  GetLeaveEncashmentQuery,
  PreviewFestivalBonusQuery,
  PreviewLeaveEncashmentQuery,
  RemoveLeaveEncashmentCommand,
  type LeaveEncashmentView,
} from './bonus.messages.js';
import { PAYROLL_MANAGE, PAYROLL_READ } from './payroll.constants.js';
import { PayrollReadRepository, type FestivalBonusSheet } from './read-models.js';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Works out bonus and encashment lines from saved salary sheets. */
@Injectable()
export class BonusCalculator {
  constructor(
    private readonly read: PayrollReadRepository,
    private readonly staff: StaffDirectory,
  ) {}

  private async savedLines(year: number, month: number) {
    const saved = await this.read.savedSheet(year, month);
    if (!saved) {
      throw new DomainError(
        'salary_sheet_not_approved',
        `Approve the salary sheet of ${MONTHS[month - 1]} ${year} first; it is the basis`,
      );
    }
    return saved.lines;
  }

  /**
   * Old Payroll.FestivalBonus: people who observe the festival, are active, joined by the cut-off and were on
   * the previous month's sheet; bonus = percentage of that month's basic.
   */
  async bonusLines(schedule: FestivalBonusSchedule): Promise<FestivalBonusLine[]> {
    const base = bonusBaseMonth(schedule.payYear, schedule.payMonth);
    const [baseLines, observers] = await Promise.all([
      this.savedLines(base.year, base.month),
      this.staff.festivalObservers(schedule.festivalId),
    ]);
    const observing = new Set(observers);
    const candidates = baseLines.filter((line) => observing.has(line.staffId));
    const people = new Map(
      (await this.staff.findSummaries(candidates.map((line) => line.staffId))).map((person) => [person.id, person]),
    );
    return candidates.flatMap((line) => {
      const person = people.get(line.staffId);
      if (!person || person.status !== 'active' || person.joiningDate > schedule.joinedBy) return [];
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
          gross: line.gross,
          basic: line.basic,
          amount: festivalBonusAmount(line.basic, schedule.percentOfBasic),
        },
      ];
    });
  }

  /** Old Payroll.LeaveIncashment: everyone on the month's sheet with leave left in the calendar year. */
  async encashmentLines(payYear: number, payMonth: number, yearlyLeaveDays: number): Promise<LeaveEncashmentLine[]> {
    const lines = await this.savedLines(payYear, payMonth);
    const taken = await this.staff.leaveDaysTaken(
      payYear,
      lines.map((line) => line.staffId),
    );
    return lines.flatMap((line) => {
      const takenDays = taken.get(line.staffId) ?? 0;
      const amounts = leaveEncashment({
        gross: line.gross,
        joiningDate: line.joiningDate,
        takenDays,
        leaveYear: payYear,
        yearlyLeaveDays,
      });
      if (!amounts) return [];
      return [
        {
          staffId: line.staffId,
          employeeNo: line.employeeNo,
          fullName: line.fullName,
          departmentId: line.departmentId,
          department: line.department,
          designation: line.designation,
          joiningDate: line.joiningDate,
          paymentMode: line.paymentMode,
          gross: line.gross,
          takenDays,
          ...amounts,
        },
      ];
    });
  }
}

const sum = (lines: readonly { amount: number }[]) => lines.reduce((total, line) => total + line.amount, 0);

@QueryHandler(PreviewFestivalBonusQuery)
export class PreviewFestivalBonusHandler implements IQueryHandler<PreviewFestivalBonusQuery> {
  constructor(
    private readonly calculator: BonusCalculator,
    private readonly read: PayrollReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, bonusId }: PreviewFestivalBonusQuery): Promise<FestivalBonusSheet> {
    await this.access.authorize(actor.userId, { permissions: [PAYROLL_READ] });
    const sheet = await this.read.festivalBonusSheet(bonusId);
    if (!sheet) throw new NotFoundError('festival_bonus');
    return { ...sheet, lines: await this.calculator.bonusLines(sheet.schedule) };
  }
}

@QueryHandler(GetFestivalBonusSheetQuery)
export class GetFestivalBonusSheetHandler implements IQueryHandler<GetFestivalBonusSheetQuery> {
  constructor(
    private readonly read: PayrollReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, bonusId }: GetFestivalBonusSheetQuery): Promise<FestivalBonusSheet> {
    await this.access.authorize(actor.userId, { permissions: [PAYROLL_READ] });
    const sheet = await this.read.festivalBonusSheet(bonusId);
    if (!sheet) throw new NotFoundError('festival_bonus');
    return sheet;
  }
}

/**
 * approve: save the bonus sheet as worked out now (again replaces it until committed);
 * commit: make it final; reverse: delete an uncommitted sheet (old ReveseAprovedFestivalBonus).
 * A bonus paid with salary cannot change once that month's salary sheet is committed.
 */
@CommandHandler(ActOnFestivalBonusCommand)
export class ActOnFestivalBonusHandler implements ICommandHandler<ActOnFestivalBonusCommand> {
  constructor(
    private readonly calculator: BonusCalculator,
    private readonly bonuses: FestivalBonusRepository,
    private readonly periods: PayPeriods,
    private readonly access: AccessControl,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async execute({ actor, bonusId, action }: ActOnFestivalBonusCommand): Promise<{ lines: number; amount: number }> {
    await this.access.authorize(actor.userId, { permissions: [PAYROLL_MANAGE] });
    return this.tx.run(async () => {
      const schedule = await this.bonuses.lock(bonusId);
      if (!schedule) throw new NotFoundError('festival_bonus');
      const status = await this.bonuses.sheetStatus(bonusId);
      if (status === 'committed') {
        throw new ConflictError('festival_bonus_committed', 'The bonus sheet is committed');
      }
      if (
        action !== 'commit' &&
        schedule.payWithSalary &&
        (await this.periods.isClosed(schedule.payYear, schedule.payMonth))
      ) {
        throw new ConflictError('pay_period_closed', 'The salary sheet this bonus is paid with is committed');
      }
      let result = { lines: 0, amount: 0 };
      if (action === 'approve') {
        const lines = await this.calculator.bonusLines(schedule);
        if (lines.length === 0) throw new DomainError('empty_bonus_sheet', 'Nobody is due this bonus');
        await this.bonuses.replaceLines(bonusId, lines, actor.userId, this.clock.now());
        result = { lines: lines.length, amount: sum(lines) };
      } else if (status === 'none') {
        throw new DomainError('festival_bonus_not_approved', 'Approve the bonus sheet first');
      } else if (action === 'commit') {
        await this.bonuses.commit(bonusId);
      } else {
        result = { lines: await this.bonuses.removeLines(bonusId), amount: 0 };
      }
      await this.audit.record({
        action: `payroll.festival_bonus_${action === 'approve' ? 'approved' : action === 'commit' ? 'committed' : 'reversed'}`,
        actorUserId: actor.userId,
        resourceType: 'festival_bonus',
        resourceId: bonusId,
        metadata: result,
      });
      return result;
    });
  }
}

@QueryHandler(PreviewLeaveEncashmentQuery)
export class PreviewLeaveEncashmentHandler implements IQueryHandler<PreviewLeaveEncashmentQuery> {
  constructor(
    private readonly calculator: BonusCalculator,
    private readonly access: AccessControl,
  ) {}

  async execute({
    actor,
    payYear,
    payMonth,
    yearlyLeaveDays,
  }: PreviewLeaveEncashmentQuery): Promise<LeaveEncashmentView> {
    assertPayPeriod(payYear, payMonth);
    await this.access.authorize(actor.userId, { permissions: [PAYROLL_READ] });
    return { payYear, payMonth, lines: await this.calculator.encashmentLines(payYear, payMonth, yearlyLeaveDays) };
  }
}

@QueryHandler(GetLeaveEncashmentQuery)
export class GetLeaveEncashmentHandler implements IQueryHandler<GetLeaveEncashmentQuery> {
  constructor(
    private readonly read: PayrollReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, payYear, payMonth }: GetLeaveEncashmentQuery): Promise<LeaveEncashmentView> {
    assertPayPeriod(payYear, payMonth);
    await this.access.authorize(actor.userId, { permissions: [PAYROLL_READ] });
    return { payYear, payMonth, lines: await this.read.leaveEncashments(payYear, payMonth) };
  }
}

/** Saves the month's encashment as worked out now, replacing what was saved for that month. */
@CommandHandler(ApproveLeaveEncashmentCommand)
export class ApproveLeaveEncashmentHandler implements ICommandHandler<ApproveLeaveEncashmentCommand> {
  constructor(
    private readonly calculator: BonusCalculator,
    private readonly encashments: LeaveEncashmentRepository,
    private readonly access: AccessControl,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async execute({ actor, payYear, payMonth, yearlyLeaveDays }: ApproveLeaveEncashmentCommand) {
    assertPayPeriod(payYear, payMonth);
    await this.access.authorize(actor.userId, { permissions: [PAYROLL_MANAGE] });
    return this.tx.run(async () => {
      await this.tx.lock(`payroll:encashment:${payYear}-${payMonth}`);
      const lines = await this.calculator.encashmentLines(payYear, payMonth, yearlyLeaveDays);
      if (lines.length === 0) throw new DomainError('empty_leave_encashment', 'Nobody has leave left to encash');
      await this.encashments.replace(payYear, payMonth, payYear, lines, actor.userId, this.clock.now());
      const result = { lines: lines.length, amount: sum(lines) };
      await this.audit.record({
        action: 'payroll.leave_encashment_approved',
        actorUserId: actor.userId,
        resourceType: 'leave_encashment',
        resourceId: `${payYear}-${String(payMonth).padStart(2, '0')}`,
        metadata: { ...result, yearlyLeaveDays },
      });
      return result;
    });
  }
}

@CommandHandler(RemoveLeaveEncashmentCommand)
export class RemoveLeaveEncashmentHandler implements ICommandHandler<RemoveLeaveEncashmentCommand> {
  constructor(
    private readonly encashments: LeaveEncashmentRepository,
    private readonly access: AccessControl,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  async execute({ actor, payYear, payMonth }: RemoveLeaveEncashmentCommand): Promise<{ removed: number }> {
    assertPayPeriod(payYear, payMonth);
    await this.access.authorize(actor.userId, { permissions: [PAYROLL_MANAGE] });
    return this.tx.run(async () => {
      await this.tx.lock(`payroll:encashment:${payYear}-${payMonth}`);
      const removed = await this.encashments.remove(payYear, payMonth);
      await this.audit.record({
        action: 'payroll.leave_encashment_removed',
        actorUserId: actor.userId,
        resourceType: 'leave_encashment',
        resourceId: `${payYear}-${String(payMonth).padStart(2, '0')}`,
        metadata: { removed },
      });
      return { removed };
    });
  }
}

export const BONUS_HANDLERS = [
  PreviewFestivalBonusHandler,
  GetFestivalBonusSheetHandler,
  ActOnFestivalBonusHandler,
  PreviewLeaveEncashmentHandler,
  GetLeaveEncashmentHandler,
  ApproveLeaveEncashmentHandler,
  RemoveLeaveEncashmentHandler,
];
