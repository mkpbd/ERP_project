import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page, PageRequest } from '../../../shared/application/pagination.js';
import type { ReturnChannel, ReturnPolicy } from '../domain/return-window.js';
import type { ProductRef } from './purchase.messages.js';

export interface ReturnFilter extends PageRequest {
  readonly saleId?: string | undefined;
  readonly outletId?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

export interface SaleReturnSummary {
  readonly id: string;
  readonly number: string;
  readonly returnedOn: string;
  readonly saleId: string;
  readonly saleNumber: string;
  readonly outletName: string;
  readonly refund: number;
  readonly dueReduced: number;
  readonly cashRefund: number;
}

export interface SaleReturnView extends SaleReturnSummary {
  readonly soldOn: string;
  readonly customerName: string | null;
  readonly loyalMemberName: string | null;
  readonly reason: string | null;
  readonly amount: number;
  readonly discount: number;
  readonly voucherNumber: string | null;
  readonly lines: (ProductRef & {
    readonly saleLine: number;
    readonly batchNo: string | null;
    readonly expiryDate: string;
    readonly qty: number;
    readonly saleRate: number;
    readonly amount: number;
    readonly discount: number;
    readonly refund: number;
  })[];
}

export abstract class ReturnReadRepository {
  abstract policies(): Promise<Record<ReturnChannel, ReturnPolicy | null>>;
  abstract listReturns(filter: ReturnFilter): Promise<Page<SaleReturnSummary>>;
  abstract getReturn(id: string): Promise<SaleReturnView | null>;
}

export class SetReturnPolicyCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly channel: ReturnChannel,
    readonly policy: ReturnPolicy,
  ) {
    super();
  }
}

export class GetReturnPoliciesQuery extends Query<Record<ReturnChannel, ReturnPolicy | null>> {
  constructor(readonly actor: Actor) {
    super();
  }
}

export class ReturnSaleCommand extends Command<{
  id: string;
  number: string;
  refund: number;
  dueReduced: number;
  cashRefund: number;
  voucherNumber: string | null;
}> {
  constructor(
    readonly actor: Actor,
    readonly saleId: string,
    /** The sale's version: a second submission of the same return is refused. */
    readonly version: number,
    readonly returnedOn: string,
    readonly reason: string | null,
    readonly lines: readonly { line: number; qty: number }[],
  ) {
    super();
  }
}

export class ListSaleReturnsQuery extends Query<Page<SaleReturnSummary>> {
  constructor(
    readonly actor: Actor,
    readonly filter: ReturnFilter,
  ) {
    super();
  }
}

export class GetSaleReturnQuery extends Query<SaleReturnView> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}
