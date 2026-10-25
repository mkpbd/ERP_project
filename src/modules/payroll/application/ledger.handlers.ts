import { Injectable } from '@nestjs/common';
import { Command, CommandHandler, Query, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import { StaffDirectory, type StaffSummary } from '../../../shared/application/contracts/staff-directory.js';
import { AuditTrail } from '../../../shared/application/ports/audit-trail.js';
import { TransactionManager } from '../../../shared/application/ports/transaction-manager.js';
import { ConflictError, DomainError, NotFoundError } from '../../../shared/domain/errors.js';
import { allocateInterest, pfPosition, type PfPosition } from '../domain/pf.js';
import { PfLedgerRepository } from '../domain/repositories.js';
import { PAYROLL_MANAGE, PAYROLL_READ } from './payroll.constants.js';
import { PayrollReadRepository, type LedgerStatement } from './read-models.js';

/** Without a staff id: the actor's own PF account. */
export class GetPfStatementQuery extends Query<LedgerStatement> {
  constructor(
    readonly actor: Actor,
    readonly from: string,
    readonly to: string,
    readonly staffId?: string,
  ) {
    super();
  }
}

/** Without a staff id: the actor's own dues. */
export class GetDuesStatementQuery extends Query<LedgerStatement> {
  constructor(
    readonly actor: Actor,
    readonly from: string,
    readonly to: string,
    readonly staffId?: string,
    readonly serviceUnitId?: string,
  ) {
    super();
  }
}

/** payroll:read, or your own account through your linked staff record. */
async function target(
  staff: StaffDirectory,
  access: AccessControl,
  actor: Actor,
  staffId: string | undefined,
  from: string,
  to: string,
): Promise<string> {
  if (from > to) throw new DomainError('invalid_period', 'The start date is after the end date');
  const own = await staff.staffIdForUser(actor.userId);
  const id = staffId ?? own;
  if (!id) throw new NotFoundError('staff');
  if (id !== own) await access.authorize(actor.userId, { permissions: [PAYROLL_READ] });
  return id;
}

@QueryHandler(GetPfStatementQuery)
export class GetPfStatementHandler implements IQueryHandler<GetPfStatementQuery> {
  constructor(
    private readonly read: PayrollReadRepository,
    private readonly staff: StaffDirectory,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, from, to, staffId }: GetPfStatementQuery): Promise<LedgerStatement> {
    return this.read.pfStatement(await target(this.staff, this.access, actor, staffId, from, to), from, to);
  }
}

@QueryHandler(GetDuesStatementQuery)
export class GetDuesStatementHandler implements IQueryHandler<GetDuesStatementQuery> {
  constructor(
    private readonly read: PayrollReadRepository,
    private readonly staff: StaffDirectory,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, from, to, staffId, serviceUnitId }: GetDuesStatementQuery): Promise<LedgerStatement> {
    const id = await target(this.staff, this.access, actor, staffId, from, to);
    return this.read.duesStatement(id, from, to, serviceUnitId);
  }
}

export interface PfInterestLine {
  readonly staffId: string;
  readonly employeeNo: string;
  readonly fullName: string;
  readonly department: string;
  readonly balance: number;
  readonly interest: number;
}

export interface PfInterestView {
  readonly asOf: string;
  readonly amount: number;
  readonly matchPercent: number;
  readonly totalBalance: number;
  readonly lines: PfInterestLine[];
}

export interface PfSettlementView extends PfPosition {
  readonly staff: Pick<
    StaffSummary,
    'id' | 'employeeNo' | 'fullName' | 'department' | 'designation' | 'joiningDate' | 'status'
  >;
  readonly asOf: string;
  readonly matchPercent: number;
}

/** Shares interest among PF members in proportion to their balances on a date, without saving. */
export class PreviewPfInterestQuery extends Query<PfInterestView> {
  constructor(
    readonly actor: Actor,
    readonly asOf: string,
    readonly amount: number,
    readonly matchPercent: number,
  ) {
    super();
  }
}

/** Credits each member's share as an interest entry dated `asOf`; once per date. */
export class DistributePfInterestCommand extends Command<{ members: number; amount: number }> {
  constructor(
    readonly actor: Actor,
    readonly asOf: string,
    readonly amount: number,
    readonly matchPercent: number,
    readonly remarks: string | null,
  ) {
    super();
  }
}

/** Without a staff id: the actor's own PF settlement. */
export class GetPfSettlementQuery extends Query<PfSettlementView> {
  constructor(
    readonly actor: Actor,
    readonly asOf: string,
    readonly matchPercent: number,
    readonly staffId?: string,
  ) {
    super();
  }
}

/** Works out each member's balance and share of the interest. */
@Injectable()
export class PfInterestCalculator {
  constructor(
    private readonly read: PayrollReadRepository,
    private readonly staff: StaffDirectory,
  ) {}

  async lines(asOf: string, amount: number, matchPercent: number): Promise<PfInterestLine[]> {
    const balances = (await this.read.pfMovements()).map((movements) => ({
      staffId: movements.staffId,
      balance: pfPosition(movements, asOf, matchPercent).balance,
    }));
    const shares = allocateInterest(amount, balances);
    const balanceOf = new Map(balances.map((member) => [member.staffId, member.balance]));
    const people = new Map(
      (await this.staff.findSummaries(shares.map((share) => share.staffId))).map((person) => [person.id, person]),
    );
    return shares
      .map((share) => {
        const person = people.get(share.staffId);
        return {
          staffId: share.staffId,
          employeeNo: person?.employeeNo ?? '',
          fullName: person?.fullName ?? '',
          department: person?.department ?? '',
          balance: balanceOf.get(share.staffId) ?? 0,
          interest: share.amount,
        };
      })
      .sort((a, b) => a.department.localeCompare(b.department) || a.employeeNo.localeCompare(b.employeeNo));
  }
}

const cents = (amount: number) => Math.round(amount * 100) / 100;

function interestView(asOf: string, amount: number, matchPercent: number, lines: PfInterestLine[]): PfInterestView {
  return {
    asOf,
    amount,
    matchPercent,
    totalBalance: cents(lines.reduce((sum, line) => sum + line.balance, 0)),
    lines,
  };
}

@QueryHandler(PreviewPfInterestQuery)
export class PreviewPfInterestHandler implements IQueryHandler<PreviewPfInterestQuery> {
  constructor(
    private readonly calculator: PfInterestCalculator,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, asOf, amount, matchPercent }: PreviewPfInterestQuery): Promise<PfInterestView> {
    await this.access.authorize(actor.userId, { permissions: [PAYROLL_READ] });
    return interestView(asOf, amount, matchPercent, await this.calculator.lines(asOf, amount, matchPercent));
  }
}

@CommandHandler(DistributePfInterestCommand)
export class DistributePfInterestHandler implements ICommandHandler<DistributePfInterestCommand> {
  constructor(
    private readonly calculator: PfInterestCalculator,
    private readonly ledger: PfLedgerRepository,
    private readonly access: AccessControl,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  async execute({ actor, asOf, amount, matchPercent, remarks }: DistributePfInterestCommand) {
    await this.access.authorize(actor.userId, { permissions: [PAYROLL_MANAGE] });
    return this.tx.run(async () => {
      await this.tx.lock('payroll:pf-interest');
      if (await this.ledger.hasInterestOn(asOf)) {
        throw new ConflictError('pf_interest_exists', `Interest was already credited on ${asOf}`);
      }
      const lines = (await this.calculator.lines(asOf, amount, matchPercent)).filter((line) => line.interest > 0);
      await this.ledger.add(
        lines.map((line) => ({
          staffId: line.staffId,
          entryDate: asOf,
          type: 'interest' as const,
          credit: line.interest,
          remarks: remarks ?? `Interest to ${asOf}`,
        })),
      );
      const result = { members: lines.length, amount };
      await this.audit.record({
        action: 'payroll.pf_interest_distributed',
        actorUserId: actor.userId,
        resourceType: 'pf_interest',
        resourceId: asOf,
        metadata: { ...result, matchPercent },
      });
      return result;
    });
  }
}

/** A person's PF position for settlement; the caller checks access. */
export async function pfSettlement(
  read: PayrollReadRepository,
  staff: StaffDirectory,
  staffId: string,
  asOf: string,
  matchPercent: number,
): Promise<PfSettlementView> {
  const [person] = await staff.findSummaries([staffId]);
  if (!person) throw new NotFoundError('staff');
  const [movements] = await read.pfMovements(staffId);
  const { id, employeeNo, fullName, department, designation, joiningDate, status } = person;
  return {
    staff: { id, employeeNo, fullName, department, designation, joiningDate, status },
    asOf,
    matchPercent,
    ...pfPosition(movements ?? { staffId, deductions: [], entries: [] }, asOf, matchPercent),
  };
}

@QueryHandler(GetPfSettlementQuery)
export class GetPfSettlementHandler implements IQueryHandler<GetPfSettlementQuery> {
  constructor(
    private readonly read: PayrollReadRepository,
    private readonly staff: StaffDirectory,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, asOf, matchPercent, staffId }: GetPfSettlementQuery): Promise<PfSettlementView> {
    const id = await target(this.staff, this.access, actor, staffId, asOf, asOf);
    return pfSettlement(this.read, this.staff, id, asOf, matchPercent);
  }
}

export const LEDGER_HANDLERS = [
  GetPfStatementHandler,
  GetDuesStatementHandler,
  PreviewPfInterestHandler,
  DistributePfInterestHandler,
  GetPfSettlementHandler,
];
