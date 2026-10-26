import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page, PageRequest } from '../../../shared/application/pagination.js';
import type { ReturnStatus } from '../domain/supplier-return.js';
import type { ProductRef } from './purchase.messages.js';

export interface DueReceive {
  readonly receiveId: string;
  readonly number: string;
  readonly receivedOn: string;
  readonly outletName: string;
  readonly supplierInvoiceNo: string | null;
  readonly total: number;
  readonly paid: number;
  readonly due: number;
}

export interface PaymentFilter extends PageRequest {
  readonly supplierId?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

export interface PaymentSummary {
  readonly id: string;
  readonly number: string;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly paidOn: string;
  readonly method: 'cash' | 'bank';
  readonly reference: string | null;
  readonly total: number;
  readonly voucherNumber: string | null;
}

export interface PaymentView extends PaymentSummary {
  readonly supplierAddress: string | null;
  /** The GL account paid from (bank payments). */
  readonly bankAccountId: string | null;
  readonly remarks: string | null;
  readonly lines: {
    readonly receiveId: string;
    readonly receiveNumber: string;
    readonly receivedOn: string;
    readonly supplierInvoiceNo: string | null;
    readonly dueBefore: number;
    readonly amount: number;
    readonly dueAfter: number;
  }[];
}

export interface ReturnFilter extends PageRequest {
  readonly supplierId?: string | undefined;
  readonly outletId?: string | undefined;
  readonly status?: string | undefined;
}

export interface ReturnSummary {
  readonly id: string;
  readonly number: string;
  readonly returnDate: string;
  readonly outletId: string;
  readonly outletName: string;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly status: ReturnStatus;
  readonly value: number;
  readonly settledValue: number;
  readonly version: number;
}

export interface ReturnView extends ReturnSummary {
  readonly reason: string;
  readonly closeReason: string | null;
  readonly sentVoucherNumber: string | null;
  readonly lines: (ProductRef & {
    readonly lotId: string;
    readonly batchNo: string | null;
    readonly expiryDate: string;
    readonly qty: number;
    readonly unitCost: number | null;
    readonly value: number | null;
  })[];
  readonly settlements: (ProductRef & {
    readonly settledOn: string;
    readonly batchNo: string | null;
    readonly expiryDate: string;
    readonly qty: number;
    readonly purchaseRate: number;
    readonly value: number;
    readonly voucherNumber: string | null;
  })[];
}

export abstract class SupplierReadRepository {
  abstract dues(supplierId: string): Promise<DueReceive[]>;
  abstract listPayments(filter: PaymentFilter): Promise<Page<PaymentSummary>>;
  abstract getPayment(id: string): Promise<PaymentView | null>;
  abstract listReturns(filter: ReturnFilter): Promise<Page<ReturnSummary>>;
  abstract getReturn(id: string): Promise<ReturnView | null>;
}

export class PaySupplierCommand extends Command<{ id: string; number: string; voucherNumber: string | null }> {
  constructor(
    readonly actor: Actor,
    readonly supplierId: string,
    readonly paidOn: string,
    readonly method: 'cash' | 'bank',
    readonly bankAccountId: string | null,
    readonly reference: string | null,
    readonly remarks: string | null,
    readonly lines: readonly { receiveId: string; amount: number }[],
  ) {
    super();
  }
}

type ReturnLineInput = { lotId: string; qty: number };

export class CreateSupplierReturnCommand extends Command<{ id: string; number: string }> {
  constructor(
    readonly actor: Actor,
    readonly outletId: string,
    readonly supplierId: string,
    readonly returnDate: string,
    readonly reason: string,
    readonly lines: readonly ReturnLineInput[],
  ) {
    super();
  }
}

export class EditSupplierReturnCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly changes: { returnDate?: string; reason?: string; lines?: readonly ReturnLineInput[] },
  ) {
    super();
  }
}

export class DeleteSupplierReturnCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
  ) {
    super();
  }
}

export class SendSupplierReturnCommand extends Command<{ value: number; voucherNumber: string | null }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
  ) {
    super();
  }
}

export interface ReplacementLine {
  readonly productId: string;
  readonly qty: number;
  readonly purchaseRate: number;
  readonly saleRate: number;
  readonly batchNo: string | null;
  readonly expiryDate: string;
}

export class SettleSupplierReturnCommand extends Command<{ status: string; voucherNumber: string | null }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly on: string,
    readonly lines: readonly ReplacementLine[],
  ) {
    super();
  }
}

export class CloseSupplierReturnCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly reason: string,
  ) {
    super();
  }
}

export class GetSupplierDuesQuery extends Query<DueReceive[]> {
  constructor(
    readonly actor: Actor,
    readonly supplierId: string,
  ) {
    super();
  }
}

export class ListPaymentsQuery extends Query<Page<PaymentSummary>> {
  constructor(
    readonly actor: Actor,
    readonly filter: PaymentFilter,
  ) {
    super();
  }
}

export class GetPaymentQuery extends Query<PaymentView> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}

export class ListSupplierReturnsQuery extends Query<Page<ReturnSummary>> {
  constructor(
    readonly actor: Actor,
    readonly filter: ReturnFilter,
  ) {
    super();
  }
}

export class GetSupplierReturnQuery extends Query<ReturnView> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}
