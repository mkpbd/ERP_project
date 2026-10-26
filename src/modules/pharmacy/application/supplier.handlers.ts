import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import type { LedgerPostingLine } from '../../../shared/application/contracts/ledger-posting.js';
import { DomainError, NotFoundError } from '../../../shared/domain/errors.js';
import { MAX_DOCUMENT_LINES, paisa, taka, text, validAmount, validRate, validUnits } from '../domain/documents.js';
import {
  PaymentRepository,
  SupplierReturnRepository,
  type NewMovement,
  type PayableSupplier,
} from '../domain/repositories.js';
import { allocatePayment } from '../domain/supplier-payment.js';
import { SupplierReturn } from '../domain/supplier-return.js';
import { PHARMACY_PAYMENT, PHARMACY_READ, PHARMACY_RECEIVE } from './pharmacy.constants.js';
import { PHARMACY_INVENTORY_ROLE, PharmacyDesk, PURCHASE_JOURNAL, SUPPLIER_PAYABLE_ROLE } from './purchase.handlers.js';
import {
  CloseSupplierReturnCommand,
  CreateSupplierReturnCommand,
  DeleteSupplierReturnCommand,
  EditSupplierReturnCommand,
  GetPaymentQuery,
  GetSupplierDuesQuery,
  GetSupplierReturnQuery,
  ListPaymentsQuery,
  ListSupplierReturnsQuery,
  PaySupplierCommand,
  SendSupplierReturnCommand,
  SettleSupplierReturnCommand,
  SupplierReadRepository,
} from './supplier.messages.js';

/** GL role paid from in cash. */
export const CASH_ROLE = 'cash_in_hand';

/** The supplier's payable on its sub-ledger. */
const payableLine = (
  supplier: PayableSupplier,
  side: 'debit' | 'credit',
  amount: number,
  narration: string,
): LedgerPostingLine => ({
  account: supplier.glAccountId ? { id: supplier.glAccountId } : { role: SUPPLIER_PAYABLE_ROLE },
  debit: side === 'debit' ? amount : 0,
  credit: side === 'credit' ? amount : 0,
  narration,
  subLedgerId: supplier.subLedgerId,
});
const inventoryLine = (side: 'debit' | 'credit', amount: number, narration: string): LedgerPostingLine => ({
  account: { role: PHARMACY_INVENTORY_ROLE },
  debit: side === 'debit' ? amount : 0,
  credit: side === 'credit' ? amount : 0,
  narration,
});

/** What the supplier handlers share on top of the pharmacy desk. */
@Injectable()
export class SupplierDesk {
  constructor(
    readonly desk: PharmacyDesk,
    readonly payments: PaymentRepository,
    readonly returns: SupplierReturnRepository,
  ) {}

  async supplierReturn(id: string, version: number): Promise<SupplierReturn> {
    const found = await this.returns.findForUpdate(id);
    if (!found) throw new NotFoundError('supplier_return');
    found.assertVersion(version);
    return found;
  }

  /** Each line's product, from its lot (NotFoundError for an unknown lot). */
  async returnLines(lines: readonly { lotId: string; qty: number }[]) {
    const facts = await this.desk.ledger.lotFacts(lines.map((line) => line.lotId));
    return lines.map((line) => ({ ...line, productId: facts.get(line.lotId)!.productId }));
  }
}

/**
 * Old ProcessSupplierDuePaymentCommand: one payment over receives of one supplier, each due worked out afresh
 * under a lock per supplier, posted Dr the supplier's payable (its sub-ledger) / Cr cash or the bank account.
 */
@CommandHandler(PaySupplierCommand)
export class PaySupplierHandler implements ICommandHandler<PaySupplierCommand> {
  constructor(private readonly suppliers: SupplierDesk) {}

  async execute(command: PaySupplierCommand) {
    const { desk, payments } = this.suppliers;
    const { actor, supplierId, paidOn, method, bankAccountId, lines } = command;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_PAYMENT] });
    if ((method === 'bank') !== (bankAccountId !== null)) {
      throw new DomainError('invalid_payment', 'A bank payment names the bank account, a cash payment does not');
    }
    const reference = text(command.reference, 100, 'reference', 'Payment');
    const remarks = text(command.remarks, 1000, 'remarks', 'Payment');
    return desk.tx.run(async () => {
      await desk.tx.lock(`pharmacy:supplier-payment:${supplierId}`);
      const supplier = await desk.supplier(supplierId);
      const dues = await payments.dues(lines.map((line) => line.receiveId));
      const { allocations, total } = allocatePayment(supplierId, lines, dues);
      const id = randomUUID();
      const number = await desk.number('SP', paidOn);
      const narration = `Payment ${number} to ${supplier.name}${reference ? `, ${reference}` : ''}`;
      const voucher = await desk.posting.post({
        journal: PURCHASE_JOURNAL,
        voucherDate: paidOn,
        narration,
        source: { module: 'pharmacy', reference: id },
        lines: [
          payableLine(supplier, 'debit', total, narration),
          {
            account: bankAccountId ? { id: bankAccountId } : { role: CASH_ROLE },
            debit: 0,
            credit: total,
            narration,
          },
        ],
        postedBy: actor.userId,
      });
      await payments.insert({
        id,
        number,
        supplierId,
        paidOn,
        method,
        bankAccountId,
        reference,
        remarks,
        total,
        voucherId: voucher.voucherId,
        voucherNumber: voucher.number,
        createdBy: actor.userId,
        allocations,
      });
      await desk.record('supplier_payment', 'made', actor, id, { number, total, voucher: voucher.number });
      return { id, number, voucherNumber: voucher.number };
    });
  }
}

@CommandHandler(CreateSupplierReturnCommand)
export class CreateSupplierReturnHandler implements ICommandHandler<CreateSupplierReturnCommand> {
  constructor(private readonly suppliers: SupplierDesk) {}

  async execute({ actor, outletId, supplierId, returnDate, reason, lines }: CreateSupplierReturnCommand) {
    const { desk, returns } = this.suppliers;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_RECEIVE] });
    return desk.tx.run(async () => {
      await desk.assertWorksAt(actor.userId, outletId);
      await desk.supplier(supplierId);
      const supplierReturn = SupplierReturn.draft({
        id: randomUUID(),
        number: await desk.number('RT', returnDate),
        outletId,
        supplierId,
        returnDate,
        reason,
        lines: await this.suppliers.returnLines(lines),
        createdBy: actor.userId,
        now: desk.clock.now(),
      });
      await returns.insert(supplierReturn);
      await desk.record('supplier_return', 'drafted', actor, supplierReturn.id, { number: supplierReturn.number });
      return { id: supplierReturn.id, number: supplierReturn.number };
    });
  }
}

@CommandHandler(EditSupplierReturnCommand)
export class EditSupplierReturnHandler implements ICommandHandler<EditSupplierReturnCommand> {
  constructor(private readonly suppliers: SupplierDesk) {}

  async execute({ actor, id, version, changes }: EditSupplierReturnCommand): Promise<void> {
    const { desk, returns } = this.suppliers;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_RECEIVE] });
    await desk.tx.run(async () => {
      const supplierReturn = await this.suppliers.supplierReturn(id, version);
      await desk.assertWorksAt(actor.userId, supplierReturn.outletId);
      const { lines, ...rest } = changes;
      supplierReturn.edit(
        { ...rest, ...(lines ? { lines: await this.suppliers.returnLines(lines) } : {}) },
        desk.clock.now(),
      );
      await returns.update(supplierReturn);
      await desk.record('supplier_return', 'edited', actor, id);
    });
  }
}

@CommandHandler(DeleteSupplierReturnCommand)
export class DeleteSupplierReturnHandler implements ICommandHandler<DeleteSupplierReturnCommand> {
  constructor(private readonly suppliers: SupplierDesk) {}

  async execute({ actor, id, version }: DeleteSupplierReturnCommand): Promise<void> {
    const { desk, returns } = this.suppliers;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_RECEIVE] });
    await desk.tx.run(async () => {
      const supplierReturn = await this.suppliers.supplierReturn(id, version);
      await desk.assertWorksAt(actor.userId, supplierReturn.outletId);
      supplierReturn.assertDeletable();
      await returns.delete(id);
      await desk.record('supplier_return', 'deleted', actor, id, { number: supplierReturn.number });
    });
  }
}

/**
 * Old ProcessSupplierReturnCommand: the lots leave the outlet's stock (never below zero: the products are locked
 * for the transaction) at their cost there, and the supplier owes that value: Dr the supplier's payable / Cr
 * pharmacy inventory.
 */
@CommandHandler(SendSupplierReturnCommand)
export class SendSupplierReturnHandler implements ICommandHandler<SendSupplierReturnCommand> {
  constructor(private readonly suppliers: SupplierDesk) {}

  async execute({ actor, id, version }: SendSupplierReturnCommand) {
    const { desk, returns } = this.suppliers;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_RECEIVE] });
    return desk.tx.run(async () => {
      const supplierReturn = await this.suppliers.supplierReturn(id, version);
      const { outletId } = supplierReturn;
      await desk.assertWorksAt(actor.userId, outletId);
      const supplier = await desk.supplier(supplierReturn.supplierId);
      for (const productId of [...new Set(supplierReturn.lines.map((line) => line.productId))].sort()) {
        await desk.tx.lock(`pharmacy:stock:${outletId}:${productId}`);
      }
      const lotIds = supplierReturn.lines.map((line) => line.lotId);
      const balances = await desk.ledger.balances(outletId, lotIds);
      supplierReturn.lines.forEach((line, index) => {
        const available = balances.get(line.lotId) ?? 0;
        if (available < line.qty) {
          throw new DomainError('insufficient_stock', `Line ${index + 1}: only ${available} of the lot are in stock`);
        }
      });
      const costs = await desk.ledger.lotCosts(outletId, lotIds);
      const value = taka(
        supplierReturn.lines.reduce((sum, line) => sum + paisa((costs.get(line.lotId) ?? 0) * line.qty), 0),
      );
      const narration = `Return ${supplierReturn.number} to ${supplier.name}`;
      const voucher =
        value > 0
          ? await desk.posting.post({
              journal: PURCHASE_JOURNAL,
              voucherDate: supplierReturn.returnDate,
              narration,
              source: { module: 'pharmacy', reference: supplierReturn.id },
              lines: [payableLine(supplier, 'debit', value, narration), inventoryLine('credit', value, narration)],
              postedBy: actor.userId,
            })
          : null;
      supplierReturn.send(costs, voucher?.number ?? null, desk.clock.now());
      const movements: NewMovement[] = supplierReturn.lines.map((line) => ({
        outletId,
        productId: line.productId,
        lotId: line.lotId,
        qty: -line.qty,
        unitCost: line.unitCost ?? 0,
        movedOn: supplierReturn.returnDate,
        kind: 'supplier_return',
        documentId: supplierReturn.id,
        documentNumber: supplierReturn.number,
      }));
      await desk.ledger.add(movements);
      await returns.update(supplierReturn);
      await desk.record('supplier_return', 'sent', actor, id, { value, voucher: voucher?.number ?? null });
      return { value: supplierReturn.value, voucherNumber: voucher?.number ?? null };
    });
  }
}

/**
 * Old ReceiveSupplierReturnCommand: replacement goods (the same products or others) come into stock in their lots
 * at the rates given, and settle the return up to its value: Dr pharmacy inventory / Cr the supplier's payable.
 */
@CommandHandler(SettleSupplierReturnCommand)
export class SettleSupplierReturnHandler implements ICommandHandler<SettleSupplierReturnCommand> {
  constructor(private readonly suppliers: SupplierDesk) {}

  async execute({ actor, id, version, on, lines }: SettleSupplierReturnCommand) {
    const { desk, returns } = this.suppliers;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_RECEIVE] });
    if (lines.length === 0 || lines.length > MAX_DOCUMENT_LINES) {
      throw new DomainError('invalid_lines', `A replacement has 1 to ${MAX_DOCUMENT_LINES} lines`);
    }
    const valued = lines.map((line, index) => {
      const at = `Line ${index + 1}`;
      validUnits(line.qty, at);
      validRate(line.purchaseRate, at);
      validAmount(line.saleRate, at);
      if (line.expiryDate <= on) throw new DomainError('expired_lot', `${at}: the lot has expired by then`);
      return {
        ...line,
        batchNo: text(line.batchNo, 50, 'batch number', at),
        value: taka(paisa(line.purchaseRate * line.qty)),
      };
    });
    const value = taka(valued.reduce((sum, line) => sum + paisa(line.value), 0));
    return desk.tx.run(async () => {
      const supplierReturn = await this.suppliers.supplierReturn(id, version);
      await desk.assertWorksAt(actor.userId, supplierReturn.outletId);
      const supplier = await desk.supplier(supplierReturn.supplierId);
      const products = await desk.facts.products(valued.map((line) => line.productId));
      valued.forEach((line, index) => {
        if (!products.get(line.productId)!.isActive) {
          throw new DomainError('inactive_product', `Line ${index + 1}: the product is inactive`);
        }
      });
      supplierReturn.settle(value, on, desk.clock.now());
      const narration = `Replacement for return ${supplierReturn.number} from ${supplier.name}`;
      const voucher =
        value > 0
          ? await desk.posting.post({
              journal: PURCHASE_JOURNAL,
              voucherDate: on,
              narration,
              source: { module: 'pharmacy', reference: supplierReturn.id },
              lines: [inventoryLine('debit', value, narration), payableLine(supplier, 'credit', value, narration)],
              postedBy: actor.userId,
            })
          : null;
      const movements: NewMovement[] = [];
      const settlements = [];
      for (const line of valued) {
        const lotId = await desk.ledger.lot(line.productId, line.batchNo, line.expiryDate, line.saleRate);
        movements.push({
          outletId: supplierReturn.outletId,
          productId: line.productId,
          lotId,
          qty: line.qty,
          unitCost: line.purchaseRate,
          movedOn: on,
          kind: 'replacement',
          documentId: supplierReturn.id,
          documentNumber: supplierReturn.number,
        });
        settlements.push({
          id: randomUUID(),
          returnId: supplierReturn.id,
          settledOn: on,
          productId: line.productId,
          lotId,
          qty: line.qty,
          purchaseRate: line.purchaseRate,
          value: line.value,
          voucherNumber: voucher?.number ?? null,
          createdBy: actor.userId,
        });
      }
      await desk.ledger.add(movements);
      await returns.addSettlements(settlements);
      await returns.update(supplierReturn);
      await desk.record('supplier_return', 'settled', actor, id, { value, status: supplierReturn.status });
      return { status: supplierReturn.status, voucherNumber: voucher?.number ?? null };
    });
  }
}

@CommandHandler(CloseSupplierReturnCommand)
export class CloseSupplierReturnHandler implements ICommandHandler<CloseSupplierReturnCommand> {
  constructor(private readonly suppliers: SupplierDesk) {}

  async execute({ actor, id, version, reason }: CloseSupplierReturnCommand): Promise<void> {
    const { desk, returns } = this.suppliers;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_RECEIVE] });
    await desk.tx.run(async () => {
      const supplierReturn = await this.suppliers.supplierReturn(id, version);
      await desk.assertWorksAt(actor.userId, supplierReturn.outletId);
      supplierReturn.close(reason, desk.clock.now());
      await returns.update(supplierReturn);
      await desk.record('supplier_return', 'closed', actor, id, { reason });
    });
  }
}

@QueryHandler(GetSupplierDuesQuery)
export class GetSupplierDuesHandler implements IQueryHandler<GetSupplierDuesQuery> {
  constructor(
    private readonly read: SupplierReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, supplierId }: GetSupplierDuesQuery) {
    await this.access.authorize(actor.userId, { permissions: [PHARMACY_READ] });
    return this.read.dues(supplierId);
  }
}

@QueryHandler(ListPaymentsQuery)
export class ListPaymentsHandler implements IQueryHandler<ListPaymentsQuery> {
  constructor(
    private readonly read: SupplierReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, filter }: ListPaymentsQuery) {
    await this.access.authorize(actor.userId, { permissions: [PHARMACY_READ] });
    return this.read.listPayments(filter);
  }
}

@QueryHandler(GetPaymentQuery)
export class GetPaymentHandler implements IQueryHandler<GetPaymentQuery> {
  constructor(
    private readonly read: SupplierReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, id }: GetPaymentQuery) {
    await this.access.authorize(actor.userId, { permissions: [PHARMACY_READ] });
    const payment = await this.read.getPayment(id);
    if (!payment) throw new NotFoundError('supplier_payment');
    return payment;
  }
}

@QueryHandler(ListSupplierReturnsQuery)
export class ListSupplierReturnsHandler implements IQueryHandler<ListSupplierReturnsQuery> {
  constructor(
    private readonly read: SupplierReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, filter }: ListSupplierReturnsQuery) {
    await this.access.authorize(actor.userId, { permissions: [PHARMACY_READ] });
    return this.read.listReturns(filter);
  }
}

@QueryHandler(GetSupplierReturnQuery)
export class GetSupplierReturnHandler implements IQueryHandler<GetSupplierReturnQuery> {
  constructor(
    private readonly read: SupplierReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, id }: GetSupplierReturnQuery) {
    await this.access.authorize(actor.userId, { permissions: [PHARMACY_READ] });
    const found = await this.read.getReturn(id);
    if (!found) throw new NotFoundError('supplier_return');
    return found;
  }
}

export const SUPPLIER_HANDLERS = [
  SupplierDesk,
  PaySupplierHandler,
  CreateSupplierReturnHandler,
  EditSupplierReturnHandler,
  DeleteSupplierReturnHandler,
  SendSupplierReturnHandler,
  SettleSupplierReturnHandler,
  CloseSupplierReturnHandler,
  GetSupplierDuesHandler,
  ListPaymentsHandler,
  GetPaymentHandler,
  ListSupplierReturnsHandler,
  GetSupplierReturnHandler,
];
