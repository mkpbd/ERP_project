import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import { StaffDirectory, type StaffSummary } from '../../../shared/application/contracts/staff-directory.js';
import type { Page } from '../../../shared/application/pagination.js';
import { AuditTrail } from '../../../shared/application/ports/audit-trail.js';
import { Clock } from '../../../shared/application/ports/clock.js';
import { TransactionManager } from '../../../shared/application/ports/transaction-manager.js';
import { ConflictError, DomainError, NotFoundError } from '../../../shared/domain/errors.js';
import { SalaryIncrementRepository, SalaryPolicyRepository, StaffSalaryRepository } from '../domain/repositories.js';
import {
  assertPayPeriod,
  incrementArrear,
  isIncrementDue,
  StaffSalary,
  type SalaryPolicyTerms,
} from '../domain/salary.js';
import { PAYROLL_MANAGE, PAYROLL_READ } from './payroll.constants.js';
import {
  PayrollReadRepository,
  type IncrementCandidate,
  type SalaryIncrementView,
  type StaffSalaryView,
} from './read-models.js';
import {
  ApplyIncrementsCommand,
  CommitIncrementsCommand,
  GetIncrementCandidatesQuery,
  GetSalaryQuery,
  ListIncrementsQuery,
  ListSalariesQuery,
  ReverseIncrementsCommand,
  ReviseStaffSalaryCommand,
  SetStaffSalaryCommand,
} from './salary.messages.js';

export const MAX_INCREMENT_ENTRIES = 1000;

/** The shape every salary change shares: payroll:manage, one transaction, one audit entry. */
@Injectable()
export class SalaryChanges {
  constructor(
    readonly salaries: StaffSalaryRepository,
    readonly increments: SalaryIncrementRepository,
    private readonly staff: StaffDirectory,
    private readonly policies: SalaryPolicyRepository,
    private readonly access: AccessControl,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    readonly clock: Clock,
  ) {}

  async run<T>(
    actor: Actor,
    action: string,
    resourceId: string,
    work: (now: Date) => Promise<{ result: T; metadata: Record<string, string | number | boolean | null> }>,
  ): Promise<T> {
    await this.access.authorize(actor.userId, { permissions: [PAYROLL_MANAGE] });
    return this.tx.run(async () => {
      const { result, metadata } = await work(this.clock.now());
      await this.audit.record({
        action: `payroll.${action}`,
        actorUserId: actor.userId,
        resourceType: 'staff_salary',
        resourceId,
        metadata,
      });
      return result;
    });
  }

  async staffById(staffIds: readonly string[]): Promise<Map<string, StaffSummary>> {
    return new Map((await this.staff.findSummaries(staffIds)).map((person) => [person.id, person]));
  }

  async terms(policyId: string): Promise<SalaryPolicyTerms> {
    const terms = await this.policies.terms(policyId);
    if (!terms) throw new NotFoundError('salary_policy');
    return terms;
  }

  lockPeriod(year: number, month: number): Promise<void> {
    return this.tx.lock(`payroll:increments:${year}-${month}`);
  }
}

@CommandHandler(SetStaffSalaryCommand)
export class SetStaffSalaryHandler implements ICommandHandler<SetStaffSalaryCommand> {
  constructor(private readonly changes: SalaryChanges) {}

  async execute({ actor, staffId, gross, settings }: SetStaffSalaryCommand): Promise<void> {
    await this.changes.run(actor, 'salary_set', staffId, async (now) => {
      const staff = (await this.changes.staffById([staffId])).get(staffId);
      if (!staff) throw new NotFoundError('staff');
      const salary = StaffSalary.create({
        staffId,
        gross,
        settings,
        terms: await this.changes.terms(settings.policyId),
        now,
      });
      await this.changes.salaries.insert(salary);
      return { result: undefined, metadata: { gross: salary.gross, policyId: salary.policyId } };
    });
  }
}

@CommandHandler(ReviseStaffSalaryCommand)
export class ReviseStaffSalaryHandler implements ICommandHandler<ReviseStaffSalaryCommand> {
  constructor(private readonly changes: SalaryChanges) {}

  async execute({ actor, staffId, version, gross, settings }: ReviseStaffSalaryCommand): Promise<void> {
    await this.changes.run(actor, 'salary_revised', staffId, async (now) => {
      const salary = await this.changes.salaries.findForUpdate(staffId);
      if (!salary) throw new NotFoundError('staff_salary');
      if (salary.version !== version) {
        throw new ConflictError('stale_salary', 'The salary was changed by someone else; reload and try again');
      }
      const before = salary.gross;
      salary.revise(
        { ...(gross === undefined ? {} : { gross }), settings },
        await this.changes.terms(settings.policyId ?? salary.policyId),
        now,
      );
      await this.changes.salaries.update(salary);
      return { result: undefined, metadata: { grossBefore: before, gross: salary.gross, policyId: salary.policyId } };
    });
  }
}

@CommandHandler(ApplyIncrementsCommand)
export class ApplyIncrementsHandler implements ICommandHandler<ApplyIncrementsCommand> {
  constructor(private readonly changes: SalaryChanges) {}

  async execute({ actor, year, month, entries }: ApplyIncrementsCommand): Promise<{ applied: number }> {
    assertPayPeriod(year, month);
    if (entries.length === 0 || entries.length > MAX_INCREMENT_ENTRIES) {
      throw new DomainError('invalid_increment', `Send 1 to ${MAX_INCREMENT_ENTRIES} people`);
    }
    if (new Set(entries.map((entry) => entry.staffId)).size !== entries.length) {
      throw new DomainError('invalid_increment', 'A person is listed twice');
    }
    const period = `${year}-${String(month).padStart(2, '0')}`;
    return this.changes.run(actor, 'increments_applied', period, async (now) => {
      await this.changes.lockPeriod(year, month);
      const staff = await this.changes.staffById(entries.map((entry) => entry.staffId));
      // Salaries are locked in a fixed order so two batches cannot deadlock.
      for (const entry of [...entries].sort((a, b) => a.staffId.localeCompare(b.staffId))) {
        const person = staff.get(entry.staffId);
        if (!person) throw new NotFoundError('staff');
        if (person.status !== 'active')
          throw new DomainError('invalid_increment', `${person.employeeNo} is not active`);
        const salary = await this.changes.salaries.findForUpdate(entry.staffId);
        if (!salary) throw new DomainError('invalid_increment', `${person.employeeNo} has no salary set up`);
        const amount = entry.amount ?? salary.incrementDue();
        if (amount === null) {
          throw new DomainError(
            'invalid_increment',
            `Enter the increment for ${person.employeeNo} (individual method)`,
          );
        }
        const method = salary.toSnapshot().incrementMethod;
        const before = salary.increase(amount, await this.changes.terms(salary.policyId), now);
        const arrear =
          entry.arrear ??
          (isIncrementDue(person.joiningDate, year, month)
            ? incrementArrear(amount, person.joiningDate, year, month)
            : 0);
        await this.changes.salaries.update(salary);
        await this.changes.increments.insert({
          id: randomUUID(),
          staffId: entry.staffId,
          year,
          month,
          method,
          amount,
          arrear,
          before,
          salaryVersion: salary.version,
          status: 'pending',
          createdBy: actor.userId,
          createdAt: now,
          committedBy: null,
          committedAt: null,
        });
      }
      return { result: { applied: entries.length }, metadata: { year, month, people: entries.length } };
    });
  }
}

@CommandHandler(CommitIncrementsCommand)
export class CommitIncrementsHandler implements ICommandHandler<CommitIncrementsCommand> {
  constructor(private readonly changes: SalaryChanges) {}

  async execute({ actor, year, month }: CommitIncrementsCommand): Promise<{ committed: number }> {
    assertPayPeriod(year, month);
    const period = `${year}-${String(month).padStart(2, '0')}`;
    return this.changes.run(actor, 'increments_committed', period, async (now) => {
      await this.changes.lockPeriod(year, month);
      const committed = await this.changes.increments.commit(year, month, actor.userId, now);
      return { result: { committed }, metadata: { year, month, committed } };
    });
  }
}

/** Undoes the month's uncommitted increments, restoring each salary exactly as it was before. */
@CommandHandler(ReverseIncrementsCommand)
export class ReverseIncrementsHandler implements ICommandHandler<ReverseIncrementsCommand> {
  constructor(private readonly changes: SalaryChanges) {}

  async execute({ actor, year, month }: ReverseIncrementsCommand): Promise<{ reversed: number }> {
    assertPayPeriod(year, month);
    const period = `${year}-${String(month).padStart(2, '0')}`;
    return this.changes.run(actor, 'increments_reversed', period, async (now) => {
      await this.changes.lockPeriod(year, month);
      const pending = (await this.changes.increments.pending(year, month)).sort((a, b) =>
        a.staffId.localeCompare(b.staffId),
      );
      const changed: string[] = [];
      for (const increment of pending) {
        const salary = await this.changes.salaries.findForUpdate(increment.staffId);
        if (!salary || salary.version !== increment.salaryVersion) {
          changed.push(increment.staffId);
          continue;
        }
        salary.undo(increment.before, now);
        await this.changes.salaries.update(salary);
      }
      if (changed.length > 0) {
        const staff = await this.changes.staffById(changed);
        const names = changed.map((id) => staff.get(id)?.employeeNo ?? id).join(', ');
        throw new ConflictError(
          'salary_changed_since_increment',
          `The salary of ${names} was changed after the increment; correct it by hand first`,
        );
      }
      await this.changes.increments.remove(pending.map((increment) => increment.id));
      return { result: { reversed: pending.length }, metadata: { year, month, reversed: pending.length } };
    });
  }
}

@QueryHandler(ListSalariesQuery)
export class ListSalariesHandler implements IQueryHandler<ListSalariesQuery> {
  constructor(
    private readonly read: PayrollReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, filter }: ListSalariesQuery): Promise<Page<StaffSalaryView>> {
    await this.access.authorize(actor.userId, { permissions: [PAYROLL_READ] });
    return this.read.listSalaries(filter);
  }
}

/** payroll:read, or your own salary through your linked staff record. */
@QueryHandler(GetSalaryQuery)
export class GetSalaryHandler implements IQueryHandler<GetSalaryQuery> {
  constructor(
    private readonly read: PayrollReadRepository,
    private readonly staff: StaffDirectory,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, staffId }: GetSalaryQuery): Promise<StaffSalaryView> {
    const own = await this.staff.staffIdForUser(actor.userId);
    const target = staffId ?? own;
    if (!target) throw new NotFoundError('staff');
    if (target !== own) await this.access.authorize(actor.userId, { permissions: [PAYROLL_READ] });
    const salary = await this.read.getSalary(target);
    if (!salary) throw new NotFoundError('staff_salary');
    return salary;
  }
}

@QueryHandler(ListIncrementsQuery)
export class ListIncrementsHandler implements IQueryHandler<ListIncrementsQuery> {
  constructor(
    private readonly read: PayrollReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, filter }: ListIncrementsQuery): Promise<SalaryIncrementView[]> {
    await this.access.authorize(actor.userId, { permissions: [PAYROLL_READ] });
    return this.read.listIncrements(filter);
  }
}

@QueryHandler(GetIncrementCandidatesQuery)
export class GetIncrementCandidatesHandler implements IQueryHandler<GetIncrementCandidatesQuery> {
  constructor(
    private readonly read: PayrollReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, year, month }: GetIncrementCandidatesQuery): Promise<IncrementCandidate[]> {
    assertPayPeriod(year, month);
    await this.access.authorize(actor.userId, { permissions: [PAYROLL_READ] });
    return this.read.incrementCandidates(year, month);
  }
}

export const SALARY_HANDLERS = [
  SetStaffSalaryHandler,
  ReviseStaffSalaryHandler,
  ApplyIncrementsHandler,
  CommitIncrementsHandler,
  ReverseIncrementsHandler,
  ListSalariesHandler,
  GetSalaryHandler,
  ListIncrementsHandler,
  GetIncrementCandidatesHandler,
];
