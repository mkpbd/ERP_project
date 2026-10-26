import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page, PageRequest } from '../../../shared/application/pagination.js';
import type { CountStatus } from '../domain/stock-count.js';
import type { ProductRef } from './purchase.messages.js';

export interface CountFilter extends PageRequest {
  readonly outletId?: string | undefined;
  readonly status?: string | undefined;
}

export interface CountSummary {
  readonly id: string;
  readonly number: string;
  readonly countDate: string;
  readonly outletId: string;
  readonly outletName: string;
  readonly status: CountStatus;
  readonly lineCount: number;
  readonly countedLines: number;
  readonly shortageValue: number;
  readonly excessValue: number;
  readonly writtenOffValue: number;
  readonly version: number;
}

export interface CountLineView extends ProductRef {
  readonly line: number;
  readonly lotId: string;
  readonly batchNo: string | null;
  readonly expiryDate: string;
  readonly expired: boolean;
  readonly systemQty: number;
  readonly countedQty: number | null;
  readonly unitCost: number;
  readonly note: string | null;
  readonly writeOff: boolean;
  readonly appliedSystemQty: number | null;
  readonly adjustedQty: number | null;
  /** Adjusted units at cost (− short, + over). */
  readonly adjustedValue: number | null;
}

export interface CountView extends CountSummary {
  readonly note: string | null;
  readonly voucherNumber: string | null;
  readonly cancelReason: string | null;
  readonly createdBy: string | null;
  readonly appliedBy: string | null;
  readonly appliedAt: Date | null;
  readonly lines: CountLineView[];
}

export abstract class CountReadRepository {
  abstract listCounts(filter: CountFilter): Promise<Page<CountSummary>>;
  abstract getCount(id: string): Promise<CountView | null>;
}

export class OpenCountCommand extends Command<{ id: string; number: string; lines: number }> {
  constructor(
    readonly actor: Actor,
    readonly outletId: string,
    readonly countDate: string,
    readonly note: string | null,
    /** Count only these products (a shelf or a group at a time); all the outlet holds when left out. */
    readonly productIds: readonly string[] | null,
  ) {
    super();
  }
}

export class RecordCountsCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly counts: readonly { lotId: string; qty: number; note?: string | null; writeOff?: boolean }[],
  ) {
    super();
  }
}

export class AddCountLotCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly lot: {
      readonly productId: string;
      readonly batchNo: string | null;
      readonly expiryDate: string;
      readonly saleRate: number;
      /** Needed when the outlet never held the lot. */
      readonly unitCost: number | null;
      readonly countedQty: number;
    },
  ) {
    super();
  }
}

export class ApplyCountCommand extends Command<{
  shortage: number;
  writtenOff: number;
  excess: number;
  voucherNumber: string | null;
}> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
  ) {
    super();
  }
}

export class CancelCountCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly reason: string,
  ) {
    super();
  }
}

export class ListCountsQuery extends Query<Page<CountSummary>> {
  constructor(
    readonly actor: Actor,
    readonly filter: CountFilter,
  ) {
    super();
  }
}

export class GetCountQuery extends Query<CountView> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}
