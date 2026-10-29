import type { CanteenItem, CustomerKind, PricedLine } from './sale.js';

export interface Outlet {
  readonly id: string;
  readonly name: string;
  readonly storeDepartmentId: string | null;
  readonly isActive: boolean;
}

export interface Member {
  readonly id: string;
  readonly name: string;
  readonly mobileNo: string;
  readonly isActive: boolean;
}

export interface SaleRow {
  readonly id: string;
  readonly number: string;
  readonly outletId: string;
  readonly soldOn: string;
  readonly soldAt: Date;
  readonly customerKind: CustomerKind;
  readonly staffId: string | null;
  readonly memberId: string | null;
  readonly customerName: string | null;
  readonly gross: number;
  readonly discount: number;
  readonly vat: number;
  readonly net: number;
  readonly paid: number;
  readonly due: number;
  readonly status: 'billed' | 'cancelled';
  readonly cancelReason: string | null;
  readonly consumptionNumber: string | null;
  readonly stockShort: boolean;
  readonly voucherNumber: string | null;
  readonly soldBy: string | null;
  readonly cancelledBy: string | null;
  readonly cancelledAt: Date | null;
  readonly version: number;
}

export interface CollectionRow {
  readonly id: string;
  readonly number: string;
  readonly memberId: string;
  readonly receivedOn: string;
  readonly amount: number;
  readonly note: string | null;
  readonly voucherNumber: string | null;
  readonly receivedBy: string | null;
}

export abstract class CanteenRepository {
  abstract nextSerial(kind: string, year: number): Promise<number>;
  abstract items(ids: readonly string[]): Promise<Map<string, CanteenItem>>;
  abstract outlet(id: string): Promise<Outlet | null>;
  abstract isOutletUser(outletId: string, userId: string): Promise<boolean>;
  abstract setOutletUsers(outletId: string, userIds: readonly string[]): Promise<void>;
  abstract memberForUpdate(id: string): Promise<Member | null>;
  /** What the member owes: dues of sales not cancelled less what they paid. */
  abstract memberBalance(id: string): Promise<number>;
  abstract insertSale(sale: SaleRow, lines: readonly PricedLine[]): Promise<void>;
  abstract saleForUpdate(id: string): Promise<SaleRow | null>;
  abstract cancelSale(id: string, reason: string, by: string, at: Date, version: number): Promise<void>;
  abstract insertCollection(collection: CollectionRow): Promise<void>;
}
