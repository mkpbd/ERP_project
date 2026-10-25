import { Query, QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import { ACCOUNTS_READ } from './accounts.constants.js';

export interface ChartAccount {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  readonly isActive: boolean;
}

export interface ChartHead<T> {
  readonly id: string;
  readonly code: string | null;
  readonly name: string;
  readonly children: T[];
}

export interface ChartNature extends ChartHead<ChartHead<ChartHead<ChartHead<ChartHead<ChartAccount>>>>> {
  readonly code: string;
  readonly statement: string;
  readonly normalBalance: string;
}

export interface ChartOfAccounts {
  readonly natures: ChartNature[];
}

export abstract class ChartReadRepository {
  /** Nature → category → sub-category → level 4 → level 5 → account, ordered by code then name. */
  abstract chart(): Promise<ChartOfAccounts>;
}

export class GetChartOfAccountsQuery extends Query<ChartOfAccounts> {
  constructor(readonly actor: Actor) {
    super();
  }
}

@QueryHandler(GetChartOfAccountsQuery)
export class GetChartOfAccountsHandler implements IQueryHandler<GetChartOfAccountsQuery> {
  constructor(
    private readonly read: ChartReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor }: GetChartOfAccountsQuery): Promise<ChartOfAccounts> {
    await this.access.authorize(actor.userId, { permissions: [ACCOUNTS_READ] });
    return this.read.chart();
  }
}
