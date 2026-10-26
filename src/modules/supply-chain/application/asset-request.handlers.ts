import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Command, CommandHandler, Query, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { LedgerPostingLine } from '../../../shared/application/contracts/ledger-posting.js';
import type { Page, PageRequest } from '../../../shared/application/pagination.js';
import { DomainError, ForbiddenError, NotFoundError } from '../../../shared/domain/errors.js';
import {
  DiscardRequest,
  ScrapSale,
  ServiceRequest,
  type AssetDecision,
  type AssetFlow,
  type ServiceType,
} from '../domain/asset-requests.js';
import { disposalCharges, type DepreciationTerms } from '../domain/depreciation.js';
import { documentNumber, paisa, taka } from '../domain/documents.js';
import {
  AssetRequestRepository,
  type DepreciationRecord,
  type PayableSupplier,
  type RequestPiece,
  type RunEntry,
} from '../domain/repositories.js';
import { ACCUMULATED_DEPRECIATION_ROLE, AssetDesk } from './asset.handlers.js';
import { DepartmentDesk } from './department.handlers.js';
import type { StockDocument } from './stock-keeper.js';
import { PURCHASE_JOURNAL, STORE_INVENTORY_ROLE, SUPPLIER_PAYABLE_ROLE } from './stock.handlers.js';
import { SCM_ASSETS, SCM_READ } from './supply-chain.constants.js';

/** GL roles of disposals, scrap sales and maintenance. */
export const DISPOSAL_LOSS_ROLE = 'asset_disposal_loss';
export const DISPOSAL_GAIN_ROLE = 'asset_disposal_gain';
export const SCRAP_INCOME_ROLE = 'scrap_sale_income';
export const CASH_ROLE = 'cash_in_hand';
export const MAINTENANCE_EXPENSE_ROLE = 'asset_maintenance_expense';
/** The payable for maintenance vendors that are not suppliers. */
export const MAINTENANCE_PAYABLE_ROLE = 'maintenance_payable';

export type AssetDocumentKind = 'service' | 'discard' | 'scrap_sale';

export interface AssetDocumentSummary {
  readonly id: string;
  readonly number: string;
  readonly date: string;
  readonly status: string;
  readonly currentLevel: number | null;
  readonly currentLevelName: string | null;
  readonly party: string | null;
  readonly version: number;
}

export interface AssetDocumentView extends AssetDocumentSummary {
  readonly kind: AssetDocumentKind;
  readonly fields: Readonly<Record<string, string | number | null>>;
  readonly lines: Readonly<Record<string, string | number | boolean | null>>[];
  readonly decisions: AssetDecision[];
}

export abstract class AssetRequestReadRepository {
  abstract list(
    kind: AssetDocumentKind,
    filter: PageRequest & { status?: string | undefined },
  ): Promise<Page<AssetDocumentSummary>>;
  abstract get(kind: AssetDocumentKind, id: string): Promise<AssetDocumentView | null>;
  abstract inbox(kind: AssetDocumentKind, roleIds: readonly string[]): Promise<AssetDocumentSummary[]>;
}

export class OpenServiceCommand extends Command<{ id: string; number: string }> {
  constructor(
    readonly actor: Actor,
    readonly requestDate: string,
    readonly sentTo: string,
    readonly supplierId: string | null,
    readonly note: string | null,
    readonly lines: readonly { assetId: string; serviceType: ServiceType; problem: string | null; cost: number }[],
  ) {
    super();
  }
}

export class OpenDiscardCommand extends Command<{ id: string; number: string }> {
  constructor(
    readonly actor: Actor,
    readonly requestDate: string,
    readonly reason: string,
    readonly lines: readonly { assetId: string; reason: string | null }[],
  ) {
    super();
  }
}

export class OpenScrapSaleCommand extends Command<{ id: string; number: string }> {
  constructor(
    readonly actor: Actor,
    readonly saleDate: string,
    readonly buyer: string,
    readonly buyerSupplierId: string | null,
    readonly lines: readonly { description: string; unit: string | null; qty: number; unitPrice: number }[],
  ) {
    super();
  }
}

export class DecideAssetDocumentCommand extends Command<{ status: string; reference: string | null }> {
  constructor(
    readonly actor: Actor,
    readonly kind: AssetDocumentKind,
    readonly id: string,
    readonly version: number,
    readonly decision: 'approve' | 'reject',
    readonly remarks: string | null,
    /** Pieces dropped at this level (service and discard). */
    readonly rejectAssets: readonly string[],
    /** The day the decision takes effect (discard: the disposal date). */
    readonly on: string,
  ) {
    super();
  }
}

export class ReceiveServiceCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly assetIds: readonly string[],
    /** What each maintenance cost (the expected cost when left out). */
    readonly costs: ReadonlyMap<string, number>,
    readonly on: string,
  ) {
    super();
  }
}

/** Proposes the sale of written-off pieces; it is decided on the discard_sale ladder. */
export class SellDiscardCommand extends Command<{ status: string }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly soldTo: string,
    readonly buyerSupplierId: string | null,
    readonly on: string,
    readonly amounts: ReadonlyMap<string, number>,
  ) {
    super();
  }
}

export class ListAssetDocumentsQuery extends Query<Page<AssetDocumentSummary>> {
  constructor(
    readonly actor: Actor,
    readonly kind: AssetDocumentKind,
    readonly filter: PageRequest & { status?: string | undefined },
  ) {
    super();
  }
}

export class GetAssetDocumentQuery extends Query<AssetDocumentView> {
  constructor(
    readonly actor: Actor,
    readonly kind: AssetDocumentKind,
    readonly id: string,
  ) {
    super();
  }
}

export class AssetInboxQuery extends Query<AssetDocumentSummary[]> {
  constructor(
    readonly actor: Actor,
    readonly kind: AssetDocumentKind,
  ) {
    super();
  }
}

/** The debit of a sale: the buyer's party ledger when a supplier, otherwise cash. */
function saleDebit(buyer: PayableSupplier | null, amount: number, narration: string): LedgerPostingLine {
  return buyer
    ? {
        account: buyer.glAccountId ? { id: buyer.glAccountId } : { role: SUPPLIER_PAYABLE_ROLE },
        debit: amount,
        credit: 0,
        narration,
        subLedgerId: buyer.subLedgerId,
      }
    : { account: { role: CASH_ROLE }, debit: amount, credit: 0, narration };
}

const stockLine = (piece: RequestPiece) => [{ variantId: piece.variantId, qty: 1, lotId: piece.lotId }];

/** What the asset request handlers share. */
@Injectable()
export class AssetRequestDesk {
  constructor(
    readonly assets: AssetDesk,
    readonly departments: DepartmentDesk,
    readonly requests: AssetRequestRepository,
  ) {}

  get desk() {
    return this.assets.desk;
  }

  /** The level the actor decides at: they hold its role and did not raise the document (or propose the sale). */
  async level(actor: Actor, flow: AssetFlow, currentLevel: number | null, createdBy: string | null) {
    const levels = await this.requests.levels(flow);
    const level = levels.find((entry) => entry.order === currentLevel);
    if (!level) throw new DomainError(`${flow}_state`, 'The document is not waiting for an approval');
    const profile = await this.desk.access.getProfile(actor.userId);
    if (!profile.roleIds.includes(level.roleId)) {
      throw new ForbiddenError('not_approver', `Only the ${level.name} approvers can decide at this level`);
    }
    if (createdBy === actor.userId) throw new ForbiddenError('self_approval', 'You cannot approve what you raised');
    return { level, levels };
  }

  /** Pieces that may go on a new request: in stock, somewhere. */
  async availablePieces(ids: readonly string[]) {
    const pieces = await this.requests.pieces(ids);
    for (const piece of pieces) {
      if (piece.status !== 'in_stock' || !piece.place) {
        throw new DomainError('asset_state', `${piece.assetNo} is ${piece.status.replace('_', ' ')}`);
      }
    }
    return pieces;
  }

  /** A supplier as a party (maintenance vendor, buyer): active, with its ledger. */
  async party(supplierId: string | null): Promise<PayableSupplier | null> {
    return supplierId ? this.departments.receiving.supplier(supplierId) : null;
  }

  /** Disposal invoices share one series (old FKH-DIS-yy#####). */
  async invoiceNumber(on: string): Promise<string> {
    const year = Number(on.slice(0, 4));
    return documentNumber('DIS', year, await this.desk.sequences.next('DIS', year));
  }
}

@CommandHandler(OpenServiceCommand)
export class OpenServiceHandler implements ICommandHandler<OpenServiceCommand> {
  constructor(private readonly requests: AssetRequestDesk) {}

  async execute({ actor, requestDate, sentTo, supplierId, note, lines }: OpenServiceCommand) {
    const { desk } = this.requests;
    await desk.access.authorize(actor.userId, { permissions: [SCM_ASSETS] });
    return desk.tx.run(async () => {
      await this.requests.party(supplierId);
      const request = ServiceRequest.open({
        id: randomUUID(),
        number: await desk.number('AS', requestDate),
        requestDate,
        sentTo,
        supplierId,
        note,
        lines,
        levels: await this.requests.requests.levels('service'),
        createdBy: actor.userId,
        now: desk.clock.now(),
      });
      await this.requests.availablePieces(request.lines.map((line) => line.assetId));
      await this.requests.requests.saveService(request, true);
      await this.requests.requests.lock(
        request.lines.map((line) => line.assetId),
        'service',
        request.id,
      );
      await desk.record('asset_service_request', 'opened', actor, request.id, { number: request.number });
      return { id: request.id, number: request.number };
    });
  }
}

@CommandHandler(OpenDiscardCommand)
export class OpenDiscardHandler implements ICommandHandler<OpenDiscardCommand> {
  constructor(private readonly requests: AssetRequestDesk) {}

  async execute({ actor, requestDate, reason, lines }: OpenDiscardCommand) {
    const { desk } = this.requests;
    await desk.access.authorize(actor.userId, { permissions: [SCM_ASSETS] });
    return desk.tx.run(async () => {
      const request = DiscardRequest.open({
        id: randomUUID(),
        number: await desk.number('AD', requestDate),
        requestDate,
        reason,
        lines,
        levels: await this.requests.requests.levels('discard'),
        createdBy: actor.userId,
        now: desk.clock.now(),
      });
      await this.requests.availablePieces(request.lines.map((line) => line.assetId));
      await this.requests.requests.saveDiscard(request, true);
      await this.requests.requests.lock(
        request.lines.map((line) => line.assetId),
        'discard',
        request.id,
      );
      await desk.record('asset_discard_request', 'opened', actor, request.id, { number: request.number });
      return { id: request.id, number: request.number };
    });
  }
}

@CommandHandler(OpenScrapSaleCommand)
export class OpenScrapSaleHandler implements ICommandHandler<OpenScrapSaleCommand> {
  constructor(private readonly requests: AssetRequestDesk) {}

  async execute({ actor, saleDate, buyer, buyerSupplierId, lines }: OpenScrapSaleCommand) {
    const { desk } = this.requests;
    await desk.access.authorize(actor.userId, { permissions: [SCM_ASSETS] });
    return desk.tx.run(async () => {
      await this.requests.party(buyerSupplierId);
      const sale = ScrapSale.open({
        id: randomUUID(),
        number: await desk.number('SS', saleDate),
        saleDate,
        buyer,
        buyerSupplierId,
        lines,
        levels: await this.requests.requests.levels('scrap_sale'),
        createdBy: actor.userId,
        now: desk.clock.now(),
      });
      await this.requests.requests.saveScrap(sale, true);
      await desk.record('scrap_sale', 'opened', actor, sale.id, { number: sale.number, total: sale.total });
      return { id: sale.id, number: sale.number };
    });
  }
}

/**
 * Approving or rejecting at the current level. The last level of a service request sends the pieces out of stock
 * with a gate pass; of a discard request writes them off (stock out, depreciation closed to the disposal date,
 * the disposal journal); of a discard request's sale or a scrap sale gives the invoice number and books the
 * proceeds. A rejection frees the pieces (a rejected sale leaves them written off).
 */
@CommandHandler(DecideAssetDocumentCommand)
export class DecideAssetDocumentHandler implements ICommandHandler<DecideAssetDocumentCommand> {
  constructor(private readonly requests: AssetRequestDesk) {}

  async execute(command: DecideAssetDocumentCommand) {
    const { desk } = this.requests;
    return desk.tx.run(async () => {
      switch (command.kind) {
        case 'service':
          return this.service(command);
        case 'discard':
          return this.discard(command);
        case 'scrap_sale':
          return this.scrap(command);
      }
    });
  }

  private async service({ actor, id, version, decision, remarks, rejectAssets, on }: DecideAssetDocumentCommand) {
    const { desk, requests, departments } = this.requests;
    const request = await requests.findService(id);
    if (!request) throw new NotFoundError('asset_service_request');
    request.assertVersion(version);
    const { level, levels } = await this.requests.level(actor, 'service', request.currentLevel, request.createdBy);
    const now = desk.clock.now();
    let reference: string | null = null;
    if (decision === 'reject') {
      request.reject({ level, by: actor.userId, remarks: remarks ?? '', now });
      await requests.unlock(request.lines.map((line) => line.assetId));
    } else {
      const out = request.approve({ level, levels, reject: rejectAssets, by: actor.userId, remarks, now });
      await requests.unlock(request.lines.filter((line) => line.rejected).map((line) => line.assetId));
      if (out.length > 0) {
        await requests.unlock(out);
        const document: StockDocument = { id: request.id, number: request.number, on };
        for (const piece of await requests.pieces(out)) {
          if (!piece.place || piece.status !== 'in_stock') {
            throw new DomainError('asset_state', `${piece.assetNo} is ${piece.status.replace('_', ' ')}`);
          }
          await departments.stores.keeper.takeOut(piece.place, stockLine(piece), document, 'service_out', {
            includeExpired: true,
          });
        }
        await requests.setStatus(out, 'out_for_service');
        const pass = await departments.issueGatePass({
          passDate: on,
          kind: 'maintenance',
          reference: request.number,
          partyName: request.sentTo,
          note: null,
        });
        request.sentOut(pass.id);
        reference = pass.number;
      }
    }
    await requests.saveService(request, false);
    await desk.record('asset_service_request', decision === 'approve' ? 'approved' : 'rejected', actor, id, {
      level: level.name,
    });
    return { status: request.status, reference };
  }

  private async discard({ actor, id, version, decision, remarks, rejectAssets, on }: DecideAssetDocumentCommand) {
    const { desk, requests } = this.requests;
    const request = await requests.findDiscard(id);
    if (!request) throw new NotFoundError('asset_discard_request');
    request.assertVersion(version);
    if (request.status === 'sale_pending') return this.sale(request, { actor, decision, remarks });
    const { level, levels } = await this.requests.level(actor, 'discard', request.currentLevel, request.createdBy);
    const now = desk.clock.now();
    let reference: string | null = null;
    if (decision === 'reject') {
      request.reject({ level, by: actor.userId, remarks: remarks ?? '', now });
      await requests.unlock(request.lines.map((line) => line.assetId));
      await requests.saveDiscard(request, false);
    } else {
      const written = request.approve({ level, levels, reject: rejectAssets, by: actor.userId, remarks, on, now });
      await requests.unlock(request.lines.filter((line) => line.rejected).map((line) => line.assetId));
      await requests.saveDiscard(request, false);
      if (written.length > 0) {
        await requests.unlock(written);
        reference = await this.writeOff(actor, request, written, on);
      }
    }
    await desk.record('asset_discard_request', decision === 'approve' ? 'approved' : 'rejected', actor, id, {
      level: level.name,
    });
    return { status: request.status, reference };
  }

  /** A decision on the sale of written-off pieces; the last level gives the invoice and books the proceeds. */
  private async sale(
    request: DiscardRequest,
    { actor, decision, remarks }: Pick<DecideAssetDocumentCommand, 'actor' | 'decision' | 'remarks'>,
  ) {
    const { desk, requests, assets } = this.requests;
    const { level, levels } = await this.requests.level(
      actor,
      'discard_sale',
      request.currentLevel,
      request.saleProposedBy,
    );
    const now = desk.clock.now();
    let reference: string | null = null;
    let voucherNumber: string | null = null;
    if (decision === 'reject') {
      request.reject({ level, by: actor.userId, remarks: remarks ?? '', now });
    } else if (request.approveSale({ level, levels, by: actor.userId, remarks, now })) {
      const on = request.soldOn!;
      reference = await this.requests.invoiceNumber(on);
      request.setInvoice(reference);
      const sold = request.lines
        .filter((line) => !line.rejected && (line.saleAmount ?? 0) > 0)
        .map((line) => line.assetId);
      if (sold.length > 0) await requests.markSold(sold);
      const total = request.saleTotal;
      if (total > 0) {
        const buyer = await this.requests.party(request.buyerSupplierId);
        const voucher = await assets.ledger.post({
          journal: PURCHASE_JOURNAL,
          voucherDate: on,
          narration: `Sale of written-off assets ${reference} to ${request.soldTo ?? ''}`,
          source: { module: 'scm', reference: request.id },
          lines: [
            saleDebit(buyer, total, reference),
            { account: { role: DISPOSAL_GAIN_ROLE }, debit: 0, credit: total, narration: reference },
          ],
          postedBy: actor.userId,
        });
        voucherNumber = voucher.number;
      }
    }
    await requests.saveDiscard(request, false);
    if (reference) await requests.recordSale(request.id, voucherNumber);
    await desk.record(
      'asset_discard_request',
      decision === 'approve' ? (reference ? 'sold' : 'sale_approved') : 'sale_rejected',
      actor,
      request.id,
      { level: level.name, ...(reference ? { invoiceNo: reference, total: request.saleTotal } : {}) },
    );
    return { status: request.status, reference };
  }

  /**
   * Writing pieces off: out of stock, depreciation charged up to the disposal date (a disposal run), and the
   * disposal journal the old system never made — accumulated depreciation and the loss of the book value against
   * the inventory account at cost.
   */
  private async writeOff(
    actor: Actor,
    request: DiscardRequest,
    ids: readonly string[],
    on: string,
  ): Promise<string | null> {
    const { desk, assets, departments } = this.requests;
    const pieces = await this.requests.requests.pieces(ids);
    for (const piece of pieces) {
      if (!piece.place || piece.status !== 'in_stock') {
        throw new DomainError('asset_state', `${piece.assetNo} is ${piece.status.replace('_', ' ')}`);
      }
      await departments.stores.keeper.takeOut(
        piece.place,
        [{ variantId: piece.variantId, qty: 1, lotId: piece.lotId }],
        { id: request.id, number: request.number, on },
        'discard',
        { includeExpired: true },
      );
    }
    await this.requests.requests.discard(ids);

    const profiles = new Map((await assets.depreciation.profiles(ids)).map((record) => [record.assetId, record]));
    const entries: RunEntry[] = [];
    const closed: DepreciationRecord[] = [];
    for (const record of profiles.values()) {
      const charges = record.status === 'active' ? disposalCharges(terms(record), record, on) : [];
      const added = charges.reduce((sum, charge) => sum + paisa(charge.amount), 0);
      entries.push(
        ...charges.map((charge) => ({
          assetId: record.assetId,
          periodIndex: charge.index,
          periodEnd: charge.periodEnd,
          amount: charge.amount,
          departmentId: null,
        })),
      );
      closed.push({
        ...record,
        periodsDone: record.periodsDone + charges.length,
        accumulated: taka(paisa(record.accumulated) + added),
        lastPeriodEnd: charges.at(-1)?.periodEnd ?? record.lastPeriodEnd,
        status: 'disposed',
      });
    }
    const runTotal = taka(entries.reduce((sum, entry) => sum + paisa(entry.amount), 0));
    let runId: string | null = null;
    if (entries.length > 0) {
      runId = randomUUID();
      const number = await desk.number('DP', on);
      const voucher =
        runTotal > 0
          ? await assets.ledger.post({
              journal: PURCHASE_JOURNAL,
              voucherDate: on,
              narration: `Depreciation to disposal, ${request.number}`,
              source: { module: 'scm', reference: runId },
              lines: assets.voucherLines(runTotal, `Depreciation to disposal ${request.number}`),
              postedBy: actor.userId,
            })
          : null;
      await assets.depreciation.insertRun(
        {
          id: runId,
          number,
          asOf: on,
          kind: 'disposal',
          status: 'posted',
          assetCount: new Set(entries.map((entry) => entry.assetId)).size,
          total: runTotal,
          voucherId: voucher?.voucherId ?? null,
          voucherNumber: voucher?.number ?? null,
          postedBy: actor.userId,
        },
        entries,
      );
    }
    if (closed.length > 0) await assets.depreciation.save(closed, actor.userId);

    const accumulatedOf = (id: string) => closed.find((record) => record.assetId === id)?.accumulated ?? 0;
    const bookValues = new Map(
      pieces.map((piece) => [piece.id, taka(paisa(piece.cost) - paisa(accumulatedOf(piece.id)))]),
    );
    const byAccount = new Map<string, number>();
    for (const piece of pieces) {
      const key = piece.inventoryGlAccountId ?? '';
      byAccount.set(key, (byAccount.get(key) ?? 0) + paisa(piece.cost));
    }
    const accumulated = pieces.reduce((sum, piece) => sum + paisa(accumulatedOf(piece.id)), 0);
    const loss = pieces.reduce((sum, piece) => sum + paisa(bookValues.get(piece.id)!), 0);
    const narration = `Write-off ${request.number}`;
    const lines: LedgerPostingLine[] = [
      ...(accumulated > 0
        ? [{ account: { role: ACCUMULATED_DEPRECIATION_ROLE }, debit: taka(accumulated), credit: 0, narration }]
        : []),
      ...(loss > 0 ? [{ account: { role: DISPOSAL_LOSS_ROLE }, debit: taka(loss), credit: 0, narration }] : []),
      ...[...byAccount.entries()]
        .filter(([, amount]) => amount > 0)
        .map(([account, amount]) => ({
          account: account ? { id: account } : { role: STORE_INVENTORY_ROLE },
          debit: 0,
          credit: taka(amount),
          narration,
        })),
    ];
    const journal =
      accumulated + loss > 0
        ? await assets.ledger.post({
            journal: PURCHASE_JOURNAL,
            voucherDate: on,
            narration,
            source: { module: 'scm', reference: request.id },
            lines,
            postedBy: actor.userId,
          })
        : null;
    await this.requests.requests.recordDisposal(request.id, {
      runId,
      voucherNumber: journal?.number ?? null,
      bookValues,
    });
    return journal?.number ?? null;
  }

  private async scrap({ actor, id, version, decision, remarks }: DecideAssetDocumentCommand) {
    const { desk, requests, assets } = this.requests;
    const sale = await requests.findScrap(id);
    if (!sale) throw new NotFoundError('scrap_sale');
    sale.assertVersion(version);
    const { level, levels } = await this.requests.level(actor, 'scrap_sale', sale.currentLevel, sale.createdBy);
    const now = desk.clock.now();
    let reference: string | null = null;
    let voucherNumber: string | null = null;
    if (decision === 'reject') {
      sale.reject({ level, by: actor.userId, remarks: remarks ?? '', now });
    } else if (sale.approve({ level, levels, by: actor.userId, remarks, now })) {
      reference = await this.requests.invoiceNumber(sale.saleDate);
      sale.setInvoice(reference);
      if (sale.total > 0) {
        const buyer = await this.requests.party(sale.buyerSupplierId);
        const voucher = await assets.ledger.post({
          journal: PURCHASE_JOURNAL,
          voucherDate: sale.saleDate,
          narration: `Scrap sale ${reference} to ${sale.buyer}`,
          source: { module: 'scm', reference: sale.id },
          lines: [
            saleDebit(buyer, sale.total, `Scrap sale ${reference}`),
            {
              account: { role: SCRAP_INCOME_ROLE },
              debit: 0,
              credit: sale.total,
              narration: `Scrap sale ${reference}`,
            },
          ],
          postedBy: actor.userId,
        });
        voucherNumber = voucher.number;
      }
    }
    await requests.saveScrap(sale, false, voucherNumber);
    await desk.record('scrap_sale', decision === 'approve' ? 'approved' : 'rejected', actor, id, { level: level.name });
    return { status: sale.status, reference };
  }
}

const terms = (record: DepreciationRecord): DepreciationTerms => ({
  frequency: record.frequency,
  lifeMonths: record.lifeMonths,
  cost: record.cost,
  residual: record.residual,
  startDate: record.startDate,
});

@CommandHandler(ReceiveServiceCommand)
export class ReceiveServiceHandler implements ICommandHandler<ReceiveServiceCommand> {
  constructor(private readonly requests: AssetRequestDesk) {}

  async execute({ actor, id, version, assetIds, costs, on }: ReceiveServiceCommand): Promise<void> {
    const { desk, requests, departments, assets } = this.requests;
    await desk.access.authorize(actor.userId, { permissions: [SCM_ASSETS] });
    await desk.tx.run(async () => {
      const request = await requests.findService(id);
      if (!request) throw new NotFoundError('asset_service_request');
      request.assertVersion(version);
      const total = request.receiveBack({ assetIds, costs, on, now: desk.clock.now() });
      // Back into the place they left, at the cost they carry.
      const document: StockDocument = { id: request.id, number: request.number, on };
      for (const piece of await requests.pieces(assetIds)) {
        if (!piece.place) throw new DomainError('asset_state', `${piece.assetNo} has no place to come back to`);
        await departments.stores.keeper.putIn(
          piece.place,
          [{ variantId: piece.variantId, lotId: piece.lotId, qty: 1, unitCost: piece.cost, line: 0 }],
          document,
          'service_return',
        );
      }
      await requests.setStatus(assetIds, 'in_stock');
      if (total > 0) {
        const vendor = await this.requests.party(request.supplierId);
        const narration = `Maintenance ${request.number} by ${request.sentTo}`;
        const voucher = await assets.ledger.post({
          journal: PURCHASE_JOURNAL,
          voucherDate: on,
          narration,
          source: { module: 'scm', reference: request.id },
          lines: [
            { account: { role: MAINTENANCE_EXPENSE_ROLE }, debit: total, credit: 0, narration },
            vendor
              ? {
                  account: vendor.glAccountId ? { id: vendor.glAccountId } : { role: SUPPLIER_PAYABLE_ROLE },
                  debit: 0,
                  credit: total,
                  narration,
                  subLedgerId: vendor.subLedgerId,
                }
              : { account: { role: MAINTENANCE_PAYABLE_ROLE }, debit: 0, credit: total, narration },
          ],
          postedBy: actor.userId,
        });
        request.booked(assetIds, voucher.number);
      }
      await requests.saveService(request, false);
      await desk.record('asset_service_request', 'received', actor, id, { pieces: assetIds.length, cost: total });
    });
  }
}

/**
 * Proposes the sale of written-off pieces (once at a time); it is approved on the discard_sale ladder, whose last
 * level gives the invoice number and books the proceeds as a gain on disposal.
 */
@CommandHandler(SellDiscardCommand)
export class SellDiscardHandler implements ICommandHandler<SellDiscardCommand> {
  constructor(private readonly requests: AssetRequestDesk) {}

  async execute({ actor, id, version, soldTo, buyerSupplierId, on, amounts }: SellDiscardCommand) {
    const { desk, requests } = this.requests;
    await desk.access.authorize(actor.userId, { permissions: [SCM_ASSETS] });
    return desk.tx.run(async () => {
      const request = await requests.findDiscard(id);
      if (!request) throw new NotFoundError('asset_discard_request');
      request.assertVersion(version);
      await this.requests.party(buyerSupplierId);
      request.proposeSale({
        amounts,
        soldTo,
        buyerSupplierId,
        on,
        levels: await requests.levels('discard_sale'),
        by: actor.userId,
        now: desk.clock.now(),
      });
      await requests.saveDiscard(request, false);
      await desk.record('asset_discard_request', 'sale_proposed', actor, id, { total: request.saleTotal });
      return { status: request.status };
    });
  }
}

@QueryHandler(ListAssetDocumentsQuery)
export class ListAssetDocumentsHandler implements IQueryHandler<ListAssetDocumentsQuery> {
  constructor(
    private readonly read: AssetRequestReadRepository,
    private readonly requests: AssetRequestDesk,
  ) {}

  async execute({ actor, kind, filter }: ListAssetDocumentsQuery) {
    await this.requests.desk.access.authorize(actor.userId, { permissions: [SCM_READ] });
    return this.read.list(kind, filter);
  }
}

@QueryHandler(GetAssetDocumentQuery)
export class GetAssetDocumentHandler implements IQueryHandler<GetAssetDocumentQuery> {
  constructor(
    private readonly read: AssetRequestReadRepository,
    private readonly requests: AssetRequestDesk,
  ) {}

  async execute({ actor, kind, id }: GetAssetDocumentQuery) {
    await this.requests.desk.access.authorize(actor.userId, { permissions: [SCM_READ] });
    const document = await this.read.get(kind, id);
    if (!document) throw new NotFoundError(kind === 'scrap_sale' ? 'scrap_sale' : `asset_${kind}_request`);
    return document;
  }
}

/** Anyone signed in: the documents waiting for one of their roles. */
@QueryHandler(AssetInboxQuery)
export class AssetInboxHandler implements IQueryHandler<AssetInboxQuery> {
  constructor(
    private readonly read: AssetRequestReadRepository,
    private readonly requests: AssetRequestDesk,
  ) {}

  async execute({ actor, kind }: AssetInboxQuery) {
    const { roleIds } = await this.requests.desk.access.getProfile(actor.userId);
    return roleIds.length === 0 ? [] : this.read.inbox(kind, roleIds);
  }
}

export const ASSET_REQUEST_HANDLERS = [
  AssetRequestDesk,
  OpenServiceHandler,
  OpenDiscardHandler,
  OpenScrapSaleHandler,
  DecideAssetDocumentHandler,
  ReceiveServiceHandler,
  SellDiscardHandler,
  ListAssetDocumentsHandler,
  GetAssetDocumentHandler,
  AssetInboxHandler,
];
