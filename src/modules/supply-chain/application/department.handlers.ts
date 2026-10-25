import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { LedgerPostingLine } from '../../../shared/application/contracts/ledger-posting.js';
import type { Page } from '../../../shared/application/pagination.js';
import { DomainError, NotFoundError } from '../../../shared/domain/errors.js';
import { DepartmentAdjustment, DepartmentConsumption, DepartmentReturn } from '../domain/department.js';
import { paisa, taka } from '../domain/documents.js';
import {
  AdjustmentRepository,
  ConsumptionRepository,
  DepartmentReturnRepository,
  GatePassRepository,
  SupplierReturnRepository,
  type CatalogueVariant,
  type PayableSupplier,
} from '../domain/repositories.js';
import { SupplierReturn } from '../domain/supplier-return.js';
import {
  CancelConsumptionCommand,
  DecideAdjustmentCommand,
  DecideDepartmentReturnCommand,
  DeleteSupplierReturnCommand,
  DepartmentReadRepository,
  DraftSupplierReturnCommand,
  EditSupplierReturnCommand,
  GetDepartmentDocumentQuery,
  IssueGatePassCommand,
  ListDepartmentDocumentsQuery,
  OpenDepartmentReturnCommand,
  PostConsumptionCommand,
  RequestAdjustmentCommand,
  SendSupplierReturnCommand,
  SettleSupplierReturnCommand,
  type DocumentSummary,
  type DocumentView,
} from './department.messages.js';
import { PURCHASE_JOURNAL, ReceiveDesk, STORE_INVENTORY_ROLE, SUPPLIER_PAYABLE_ROLE } from './stock.handlers.js';
import { StoreDesk } from './store.handlers.js';
import { SCM_ADJUST, SCM_DEPARTMENT, SCM_ISSUE, SCM_READ, SCM_RECEIVE } from './supply-chain.constants.js';

/**
 * A voucher between inventory (each item type's account, else the store_inventory role) and the supplier's
 * payable on their sub-ledger. `inventory: 'credit'` for goods going back (a debit note), `'debit'` for goods
 * coming in.
 */
export function inventoryVoucherLines(
  values: ReadonlyMap<string, number>,
  variants: ReadonlyMap<string, CatalogueVariant>,
  supplier: PayableSupplier,
  narration: string,
  inventory: 'debit' | 'credit',
): LedgerPostingLine[] {
  const byAccount = new Map<string, number>();
  for (const [variantId, value] of values) {
    const account = variants.get(variantId)?.inventoryGlAccountId ?? '';
    byAccount.set(account, (byAccount.get(account) ?? 0) + paisa(value));
  }
  const total = [...byAccount.values()].reduce((sum, amount) => sum + amount, 0);
  const side = (amount: number, isInventory: boolean) =>
    (inventory === 'debit') === isInventory ? { debit: taka(amount), credit: 0 } : { debit: 0, credit: taka(amount) };
  return [
    ...[...byAccount.entries()]
      .filter(([, amount]) => amount > 0)
      .map(([account, amount]) => ({
        account: account ? { id: account } : { role: STORE_INVENTORY_ROLE },
        ...side(amount, true),
        narration,
      })),
    {
      account: supplier.glAccountId ? { id: supplier.glAccountId } : { role: SUPPLIER_PAYABLE_ROLE },
      ...side(total, false),
      narration,
      subLedgerId: supplier.subLedgerId,
    },
  ];
}

/** What the department and supplier return handlers share. */
@Injectable()
export class DepartmentDesk {
  constructor(
    readonly stores: StoreDesk,
    readonly receiving: ReceiveDesk,
    readonly consumptions: ConsumptionRepository,
    readonly returns: DepartmentReturnRepository,
    readonly adjustments: AdjustmentRepository,
    readonly supplierReturns: SupplierReturnRepository,
    readonly gatePasses: GatePassRepository,
  ) {}

  get desk() {
    return this.stores.desk;
  }

  async issueGatePass(pass: {
    passDate: string;
    kind: 'supplier_return' | 'maintenance' | 'other';
    reference: string | null;
    partyName: string;
    note: string | null;
  }): Promise<{ id: string; number: string }> {
    const partyName = pass.partyName.trim();
    if (partyName.length === 0 || partyName.length > 200) {
      throw new DomainError('invalid_party', 'Name who takes the goods (1-200 characters)');
    }
    const id = randomUUID();
    const number = await this.desk.number('GP', pass.passDate);
    await this.gatePasses.insert({ ...pass, partyName, note: pass.note?.trim() || null, id, number });
    return { id, number };
  }
}

@CommandHandler(PostConsumptionCommand)
export class PostConsumptionHandler implements ICommandHandler<PostConsumptionCommand> {
  constructor(private readonly departments: DepartmentDesk) {}

  async execute({ actor, departmentId, consumedOn, note, lines }: PostConsumptionCommand) {
    const { desk, stores } = this.departments;
    await desk.access.authorize(actor.userId, { permissions: [SCM_DEPARTMENT] });
    await stores.assertMayIndentFor(actor.userId, departmentId);
    return desk.tx.run(async () => {
      const consumption = DepartmentConsumption.post({
        id: randomUUID(),
        number: await desk.number('DC', consumedOn),
        departmentId,
        consumedOn,
        note,
        lines,
        createdBy: actor.userId,
        now: desk.clock.now(),
      });
      await this.departments.consumptions.insert(consumption);
      await stores.keeper.takeOut(
        { departmentId },
        consumption.lines,
        { id: consumption.id, number: consumption.number, on: consumedOn },
        'consumption',
      );
      await desk.record('department_consumption', 'posted', actor, consumption.id, { number: consumption.number });
      return { id: consumption.id, number: consumption.number };
    });
  }
}

@CommandHandler(CancelConsumptionCommand)
export class CancelConsumptionHandler implements ICommandHandler<CancelConsumptionCommand> {
  constructor(private readonly departments: DepartmentDesk) {}

  async execute({ actor, id, version, reason, on }: CancelConsumptionCommand): Promise<void> {
    const { desk, stores } = this.departments;
    await desk.access.authorize(actor.userId, { permissions: [SCM_DEPARTMENT] });
    await desk.tx.run(async () => {
      const consumption = await this.departments.consumptions.findForUpdate(id);
      if (!consumption) throw new NotFoundError('department_consumption');
      consumption.assertVersion(version);
      await stores.assertMayIndentFor(actor.userId, consumption.departmentId);
      consumption.cancel(actor.userId, reason, desk.clock.now());
      await stores.ledger.reverse(id, on);
      await this.departments.consumptions.update(consumption);
      await desk.record('department_consumption', 'cancelled', actor, id, { reason });
    });
  }
}

@CommandHandler(OpenDepartmentReturnCommand)
export class OpenDepartmentReturnHandler implements ICommandHandler<OpenDepartmentReturnCommand> {
  constructor(private readonly departments: DepartmentDesk) {}

  async execute({ actor, departmentId, subStoreId, returnDate, reason, lines }: OpenDepartmentReturnCommand) {
    const { desk, stores } = this.departments;
    await desk.access.authorize(actor.userId, { permissions: [SCM_DEPARTMENT] });
    await stores.assertMayIndentFor(actor.userId, departmentId);
    return desk.tx.run(async () => {
      const departmentReturn = DepartmentReturn.open({
        id: randomUUID(),
        number: await desk.number('DR', returnDate),
        departmentId,
        subStoreId,
        returnDate,
        reason,
        lines,
        createdBy: actor.userId,
        now: desk.clock.now(),
      });
      await this.departments.returns.insert(departmentReturn);
      await desk.record('department_return', 'opened', actor, departmentReturn.id, { number: departmentReturn.number });
      return { id: departmentReturn.id, number: departmentReturn.number };
    });
  }
}

@CommandHandler(DecideDepartmentReturnCommand)
export class DecideDepartmentReturnHandler implements ICommandHandler<DecideDepartmentReturnCommand> {
  constructor(private readonly departments: DepartmentDesk) {}

  async execute({ actor, id, version, decision, on }: DecideDepartmentReturnCommand): Promise<void> {
    const { desk, stores } = this.departments;
    await desk.access.authorize(actor.userId, { permissions: [decision === 'receive' ? SCM_ISSUE : SCM_DEPARTMENT] });
    await desk.tx.run(async () => {
      const departmentReturn = await this.departments.returns.findForUpdate(id);
      if (!departmentReturn) throw new NotFoundError('department_return');
      departmentReturn.assertVersion(version);
      const now = desk.clock.now();
      if (decision === 'cancel') {
        await stores.assertMayIndentFor(actor.userId, departmentReturn.departmentId);
        departmentReturn.cancel(now);
      } else {
        if (!on) throw new DomainError('invalid_date', 'Give the date the goods came back');
        await stores.assertMayIssueFrom(actor.userId, departmentReturn.subStoreId);
        departmentReturn.receive(actor.userId, on, now);
        const document = { id, number: departmentReturn.number, on };
        const taken = await stores.keeper.takeOut(
          { departmentId: departmentReturn.departmentId },
          departmentReturn.lines,
          document,
          'department_return',
          { includeExpired: true },
        );
        await stores.keeper.putIn({ subStoreId: departmentReturn.subStoreId }, taken, document, 'department_return');
      }
      await this.departments.returns.update(departmentReturn);
      await desk.record('department_return', decision === 'receive' ? 'received' : 'cancelled', actor, id);
    });
  }
}

@CommandHandler(RequestAdjustmentCommand)
export class RequestAdjustmentHandler implements ICommandHandler<RequestAdjustmentCommand> {
  constructor(private readonly departments: DepartmentDesk) {}

  async execute({ actor, departmentId, countedOn, reason, lines }: RequestAdjustmentCommand) {
    const { desk, stores } = this.departments;
    await desk.access.authorize(actor.userId, { permissions: [SCM_DEPARTMENT] });
    await stores.assertMayIndentFor(actor.userId, departmentId);
    return desk.tx.run(async () => {
      const balances = await stores.ledger.balances(
        { departmentId },
        lines.map((line) => line.variantId),
      );
      const held = (variantId: string, lotId: string) =>
        balances.get(variantId)?.find((lot) => lot.lotId === lotId)?.qty ?? 0;
      const adjustment = DepartmentAdjustment.request({
        id: randomUUID(),
        number: await desk.number('DA', countedOn),
        departmentId,
        countedOn,
        reason,
        lines: lines.map((line) => ({
          ...line,
          systemQty: Math.round(held(line.variantId, line.lotId) * 1000) / 1000,
        })),
        createdBy: actor.userId,
        now: desk.clock.now(),
      });
      await this.departments.adjustments.insert(adjustment);
      await desk.record('department_adjustment', 'requested', actor, adjustment.id, { number: adjustment.number });
      return { id: adjustment.id, number: adjustment.number };
    });
  }
}

/**
 * Approving a count sets each lot to what was counted, against the records at approval: a shortfall leaves
 * the department (expired lots too), a surplus comes in at the lot's cost in the department, or at its received
 * cost when the department held none.
 */
@CommandHandler(DecideAdjustmentCommand)
export class DecideAdjustmentHandler implements ICommandHandler<DecideAdjustmentCommand> {
  constructor(private readonly departments: DepartmentDesk) {}

  async execute({ actor, id, version, decision, remarks }: DecideAdjustmentCommand): Promise<void> {
    const { desk, stores } = this.departments;
    await desk.access.authorize(actor.userId, { permissions: [decision === 'cancel' ? SCM_DEPARTMENT : SCM_ADJUST] });
    await desk.tx.run(async () => {
      const adjustment = await this.departments.adjustments.findForUpdate(id);
      if (!adjustment) throw new NotFoundError('department_adjustment');
      adjustment.assertVersion(version);
      const now = desk.clock.now();
      const place = { departmentId: adjustment.departmentId };
      if (decision === 'cancel') adjustment.cancel(now);
      if (decision === 'reject') adjustment.reject({ by: actor.userId, remarks: remarks ?? '', now });
      if (decision === 'approve') {
        const variantIds = adjustment.lines.map((line) => line.variantId);
        for (const variantId of [...new Set(variantIds)].sort()) {
          await desk.tx.lock(`scm:stock:department:${adjustment.departmentId}:${variantId}`);
        }
        const balances = await stores.ledger.balances(place, variantIds);
        const lots = new Map([...balances.values()].flat().map((lot) => [lot.lotId, lot]));
        const lines = adjustment.approve({
          by: actor.userId,
          current: new Map([...lots.values()].map((lot) => [lot.lotId, lot.qty])),
          remarks,
          now,
        });
        const movements = [];
        for (const line of lines) {
          if (!line.adjustQty) continue;
          const lot = lots.get(line.lotId);
          const unitCost = lot && lot.qty > 0 ? lot.value / lot.qty : await stores.ledger.lotCost(line.lotId);
          movements.push({
            store: place,
            variantId: line.variantId,
            lotId: line.lotId,
            qty: line.adjustQty,
            unitCost: Math.round(unitCost * 10_000) / 10_000,
            movedOn: adjustment.countedOn,
            kind: 'adjustment' as const,
            documentId: id,
            documentNumber: adjustment.number,
          });
        }
        await stores.ledger.add(movements);
      }
      await this.departments.adjustments.update(adjustment);
      const done = { approve: 'approved', reject: 'rejected', cancel: 'cancelled' };
      await desk.record('department_adjustment', done[decision], actor, id);
    });
  }
}

@CommandHandler(DraftSupplierReturnCommand)
export class DraftSupplierReturnHandler implements ICommandHandler<DraftSupplierReturnCommand> {
  constructor(private readonly departments: DepartmentDesk) {}

  async execute({ actor, mainStoreId, supplierId, returnDate, reason, lines }: DraftSupplierReturnCommand) {
    const { desk, receiving } = this.departments;
    await desk.access.authorize(actor.userId, { permissions: [SCM_RECEIVE] });
    return desk.tx.run(async () => {
      await receiving.supplier(supplierId);
      const supplierReturn = SupplierReturn.draft({
        id: randomUUID(),
        number: await desk.number('RT', returnDate),
        mainStoreId,
        supplierId,
        returnDate,
        reason,
        lines,
        createdBy: actor.userId,
        now: desk.clock.now(),
      });
      await this.departments.supplierReturns.insert(supplierReturn);
      await desk.record('supplier_return', 'drafted', actor, supplierReturn.id, { number: supplierReturn.number });
      return { id: supplierReturn.id, number: supplierReturn.number };
    });
  }
}

async function supplierReturnFor(departments: DepartmentDesk, id: string, version: number): Promise<SupplierReturn> {
  const supplierReturn = await departments.supplierReturns.findForUpdate(id);
  if (!supplierReturn) throw new NotFoundError('supplier_return');
  supplierReturn.assertVersion(version);
  return supplierReturn;
}

@CommandHandler(EditSupplierReturnCommand)
export class EditSupplierReturnHandler implements ICommandHandler<EditSupplierReturnCommand> {
  constructor(private readonly departments: DepartmentDesk) {}

  async execute({ actor, id, version, changes }: EditSupplierReturnCommand): Promise<void> {
    const { desk } = this.departments;
    await desk.access.authorize(actor.userId, { permissions: [SCM_RECEIVE] });
    await desk.tx.run(async () => {
      const supplierReturn = await supplierReturnFor(this.departments, id, version);
      supplierReturn.edit(changes, desk.clock.now());
      await this.departments.supplierReturns.update(supplierReturn);
      await desk.record('supplier_return', 'edited', actor, id);
    });
  }
}

@CommandHandler(DeleteSupplierReturnCommand)
export class DeleteSupplierReturnHandler implements ICommandHandler<DeleteSupplierReturnCommand> {
  constructor(private readonly departments: DepartmentDesk) {}

  async execute({ actor, id, version }: DeleteSupplierReturnCommand): Promise<void> {
    const { desk } = this.departments;
    await desk.access.authorize(actor.userId, { permissions: [SCM_RECEIVE] });
    await desk.tx.run(async () => {
      const supplierReturn = await supplierReturnFor(this.departments, id, version);
      supplierReturn.assertDeletable();
      await this.departments.supplierReturns.delete(id);
      await desk.record('supplier_return', 'deleted', actor, id);
    });
  }
}

/** Sending: the lots leave the main store (expired ones too), a gate pass is issued and a debit note posted. */
@CommandHandler(SendSupplierReturnCommand)
export class SendSupplierReturnHandler implements ICommandHandler<SendSupplierReturnCommand> {
  constructor(private readonly departments: DepartmentDesk) {}

  async execute({ actor, id, version }: SendSupplierReturnCommand) {
    const { desk, stores, receiving } = this.departments;
    await desk.access.authorize(actor.userId, { permissions: [SCM_RECEIVE] });
    return desk.tx.run(async () => {
      const supplierReturn = await supplierReturnFor(this.departments, id, version);
      if (supplierReturn.status !== 'draft') {
        throw new DomainError('supplier_return_state', `A ${supplierReturn.status} return cannot be sent`);
      }
      const supplier = await receiving.supplier(supplierReturn.supplierId);
      const taken = await stores.keeper.takeOut(
        { mainStoreId: supplierReturn.mainStoreId },
        supplierReturn.lines,
        { id, number: supplierReturn.number, on: supplierReturn.returnDate },
        'supplier_return',
        { includeExpired: true },
      );
      const unitCosts = supplierReturn.lines.map((line, index) => {
        const value = taken
          .filter((part) => part.line === index)
          .reduce((sum, part) => sum + part.qty * part.unitCost, 0);
        return Math.round((value / line.qty) * 10_000) / 10_000;
      });
      const gatePass = await this.departments.issueGatePass({
        passDate: supplierReturn.returnDate,
        kind: 'supplier_return',
        reference: supplierReturn.number,
        partyName: supplier.name,
        note: null,
      });
      const values = new Map<string, number>();
      supplierReturn.lines.forEach((line, index) =>
        values.set(line.variantId, (values.get(line.variantId) ?? 0) + taka(paisa(unitCosts[index]! * line.qty))),
      );
      const total = [...values.values()].reduce((sum, value) => sum + value, 0);
      const variants = await receiving.catalogue.variants([...values.keys()]);
      const voucher =
        total > 0
          ? await receiving.ledger.post({
              journal: PURCHASE_JOURNAL,
              voucherDate: supplierReturn.returnDate,
              narration: `Return ${supplierReturn.number} to ${supplier.name}`,
              source: { module: 'scm', reference: id },
              lines: inventoryVoucherLines(
                values,
                variants,
                supplier,
                `${supplierReturn.number} to ${supplier.name}`,
                'credit',
              ),
              postedBy: actor.userId,
            })
          : null;
      supplierReturn.send({
        unitCosts,
        voucher: voucher && { id: voucher.voucherId, number: voucher.number },
        gatePassId: gatePass.id,
        now: desk.clock.now(),
      });
      await this.departments.supplierReturns.update(supplierReturn);
      await desk.record('supplier_return', 'sent', actor, id, {
        gatePass: gatePass.number,
        voucher: voucher?.number ?? null,
      });
      return { gatePassNumber: gatePass.number, voucherNumber: voucher?.number ?? null };
    });
  }
}

/**
 * Settling: what the supplier sent back for each line comes into the main store in its own lot at the cost of
 * what was returned, and that much of the debit note is reversed. Whatever does not come back stays owed by the
 * supplier.
 */
@CommandHandler(SettleSupplierReturnCommand)
export class SettleSupplierReturnHandler implements ICommandHandler<SettleSupplierReturnCommand> {
  constructor(private readonly departments: DepartmentDesk) {}

  async execute({ actor, id, version, on, lines }: SettleSupplierReturnCommand) {
    const { desk, stores, receiving } = this.departments;
    await desk.access.authorize(actor.userId, { permissions: [SCM_RECEIVE] });
    return desk.tx.run(async () => {
      const supplierReturn = await supplierReturnFor(this.departments, id, version);
      const supplier = await receiving.supplier(supplierReturn.supplierId);
      const backValue = supplierReturn.settle({ lines, on, now: desk.clock.now() });
      const values = new Map<string, number>();
      const movements = [];
      for (const line of supplierReturn.lines) {
        if (!line.receivedQty) continue;
        const variantId = line.replacementVariantId ?? line.variantId;
        const lotId = await stores.ledger.lot(variantId, line.replacementBatchNo, line.replacementExpiryDate);
        movements.push({
          store: { mainStoreId: supplierReturn.mainStoreId },
          variantId,
          lotId,
          qty: line.receivedQty,
          unitCost: line.unitCost ?? 0,
          movedOn: on,
          kind: 'supplier_return' as const,
          documentId: id,
          documentNumber: supplierReturn.number,
        });
        values.set(variantId, (values.get(variantId) ?? 0) + taka(paisa((line.unitCost ?? 0) * line.receivedQty)));
      }
      const variants = await receiving.catalogue.variants([...values.keys()]);
      for (const [index, line] of supplierReturn.lines.entries()) {
        const variant = variants.get(line.replacementVariantId ?? line.variantId);
        if (line.receivedQty && variant?.expiryRequired && !line.replacementExpiryDate) {
          throw new DomainError('expiry_required', `Line ${index + 1}: the item needs an expiry date`);
        }
      }
      await stores.ledger.add(movements);
      const voucher =
        backValue > 0
          ? await receiving.ledger.post({
              journal: PURCHASE_JOURNAL,
              voucherDate: on,
              narration: `Replacement for return ${supplierReturn.number} from ${supplier.name}`,
              source: { module: 'scm', reference: id },
              lines: inventoryVoucherLines(
                values,
                variants,
                supplier,
                `${supplierReturn.number} from ${supplier.name}`,
                'debit',
              ),
              postedBy: actor.userId,
            })
          : null;
      supplierReturn.setSettlementVoucher(voucher && { id: voucher.voucherId, number: voucher.number });
      await this.departments.supplierReturns.update(supplierReturn);
      await desk.record('supplier_return', 'settled', actor, id, {
        value: backValue,
        voucher: voucher?.number ?? null,
      });
      return { voucherNumber: voucher?.number ?? null };
    });
  }
}

@CommandHandler(IssueGatePassCommand)
export class IssueGatePassHandler implements ICommandHandler<IssueGatePassCommand> {
  constructor(private readonly departments: DepartmentDesk) {}

  async execute({ actor, pass }: IssueGatePassCommand) {
    const { desk } = this.departments;
    await desk.access.authorize(actor.userId, { permissions: [SCM_ISSUE] });
    return desk.tx.run(async () => {
      const issued = await this.departments.issueGatePass(pass);
      await desk.record('gate_pass', 'issued', actor, issued.id, { number: issued.number });
      return issued;
    });
  }
}

@QueryHandler(ListDepartmentDocumentsQuery)
export class ListDepartmentDocumentsHandler implements IQueryHandler<ListDepartmentDocumentsQuery> {
  constructor(
    private readonly read: DepartmentReadRepository,
    private readonly departments: DepartmentDesk,
  ) {}

  async execute({ actor, kind, filter }: ListDepartmentDocumentsQuery): Promise<Page<DocumentSummary>> {
    await this.departments.desk.access.authorize(actor.userId, { permissions: [SCM_READ] });
    return this.read.list(kind, filter);
  }
}

@QueryHandler(GetDepartmentDocumentQuery)
export class GetDepartmentDocumentHandler implements IQueryHandler<GetDepartmentDocumentQuery> {
  constructor(
    private readonly read: DepartmentReadRepository,
    private readonly departments: DepartmentDesk,
  ) {}

  async execute({ actor, kind, id }: GetDepartmentDocumentQuery): Promise<DocumentView> {
    await this.departments.desk.access.authorize(actor.userId, { permissions: [SCM_READ] });
    const document = await this.read.get(kind, id);
    if (!document)
      throw new NotFoundError(
        kind === 'return'
          ? 'department_return'
          : kind === 'consumption' || kind === 'adjustment'
            ? `department_${kind}`
            : kind,
      );
    return document;
  }
}

export const DEPARTMENT_HANDLERS = [
  DepartmentDesk,
  PostConsumptionHandler,
  CancelConsumptionHandler,
  OpenDepartmentReturnHandler,
  DecideDepartmentReturnHandler,
  RequestAdjustmentHandler,
  DecideAdjustmentHandler,
  DraftSupplierReturnHandler,
  EditSupplierReturnHandler,
  DeleteSupplierReturnHandler,
  SendSupplierReturnHandler,
  SettleSupplierReturnHandler,
  IssueGatePassHandler,
  ListDepartmentDocumentsHandler,
  GetDepartmentDocumentHandler,
];
