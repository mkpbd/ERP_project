import { Query, QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import { StaffDirectory } from '../../../shared/application/contracts/staff-directory.js';
import { DomainError, NotFoundError } from '../../../shared/domain/errors.js';
import { PAYROLL_READ } from './payroll.constants.js';
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

export const LEDGER_HANDLERS = [GetPfStatementHandler, GetDuesStatementHandler];
