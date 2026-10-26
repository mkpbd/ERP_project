import { ConflictError, DomainError } from '../../../shared/domain/errors.js';
import {
  firstLevel,
  MAX_DOCUMENT_LINES,
  nextLevel,
  paisa,
  taka,
  validAmount,
  validQuantity,
  validRemarks,
  type ApprovalLevel,
  type Decision,
} from './documents.js';

export type AssetFlow = 'service' | 'discard' | 'discard_sale' | 'scrap_sale';

/** A decision, and whether it was on the document itself or on the sale of a discard request. */
export interface AssetDecision extends Decision {
  readonly stage: 'request' | 'sale';
}

const text = (value: string | null, max: number, what: string, required = false): string | null => {
  const trimmed = value?.trim() ?? '';
  if (required && trimmed.length === 0) throw new DomainError('invalid_text', `Give the ${what}`);
  if (trimmed.length > max) throw new DomainError('invalid_text', `The ${what} is at most ${max} characters`);
  return trimmed.length > 0 ? trimmed : null;
};

interface Ladder {
  status: string;
  currentLevel: number | null;
  decisions: AssetDecision[];
  version: number;
  updatedAt: Date;
}

/** The approval ladder the asset documents share (old Level1..Final settings per flow). */
abstract class LadderDocument<P extends Ladder> {
  protected constructor(protected readonly props: P) {}

  protected abstract readonly what: string;

  /** The stage a decision now is on. */
  protected get stage(): AssetDecision['stage'] {
    return 'request';
  }

  /** Whether the document waits for a decision. */
  protected get awaiting(): boolean {
    return this.props.status === 'pending';
  }

  get status(): string {
    return this.props.status;
  }
  get currentLevel(): number | null {
    return this.props.currentLevel;
  }

  protected startApproval(levels: readonly ApprovalLevel[], what: string): void {
    this.props.currentLevel = firstLevel(levels, what).order;
  }

  /** Records the decision and moves to the next level; returns true when this was the final level. */
  protected advance(params: {
    level: ApprovalLevel;
    levels: readonly ApprovalLevel[];
    by: string;
    remarks: string | null;
    now: Date;
  }): boolean {
    this.assertDecidable(params.level);
    this.decide(params.level, 'approved', params.by, validRemarks(params.remarks, false), params.now);
    const next = nextLevel(params.levels, params.level);
    this.props.currentLevel = next?.order ?? null;
    return next === null;
  }

  reject(params: { level: ApprovalLevel; by: string; remarks: string; now: Date }): void {
    this.assertDecidable(params.level);
    this.decide(params.level, 'rejected', params.by, validRemarks(params.remarks, true), params.now);
    this.props.status = 'rejected';
    this.props.currentLevel = null;
    this.touch(params.now);
  }

  assertVersion(version: number): void {
    if (version !== this.props.version) {
      throw new ConflictError(`stale_${this.what}`, 'The document was changed by someone else; reload it');
    }
  }

  protected assertDecidable(level: ApprovalLevel): void {
    if (!this.awaiting) {
      throw new DomainError(`${this.what}_state`, `A ${this.props.status} document cannot be decided`);
    }
    if (level.order !== this.props.currentLevel) {
      throw new DomainError('wrong_level', 'The document is waiting for another approval level');
    }
  }

  protected decide(
    level: ApprovalLevel,
    decision: Decision['decision'],
    by: string,
    remarks: string | null,
    now: Date,
  ): void {
    this.props.decisions.push({
      stage: this.stage,
      levelOrder: level.order,
      levelName: level.name,
      decision,
      decidedBy: by,
      decidedAt: now,
      remarks,
    });
  }

  protected touch(now: Date): void {
    this.props.version += 1;
    this.props.updatedAt = now;
  }
}

function assetLines<T extends { assetId: string }>(lines: readonly T[], what: string): T[] {
  if (lines.length === 0 || lines.length > MAX_DOCUMENT_LINES) {
    throw new DomainError('invalid_lines', `A ${what} has 1 to ${MAX_DOCUMENT_LINES} pieces`);
  }
  const seen = new Set<string>();
  for (const [index, line] of lines.entries()) {
    if (seen.has(line.assetId))
      throw new DomainError('duplicate_line', `Line ${index + 1}: the piece is already on the ${what}`);
    seen.add(line.assetId);
  }
  return [...lines];
}

// Warranty and maintenance

export type ServiceType = 'warranty' | 'maintenance';

export interface ServiceLine {
  readonly assetId: string;
  readonly serviceType: ServiceType;
  readonly problem: string | null;
  /** What the maintenance costs (always 0 for warranty, as before). */
  readonly cost: number;
  readonly rejected: boolean;
  readonly returnedOn: string | null;
  /** What it did cost, when back (warranty: 0), and the voucher that booked it. */
  readonly actualCost: number | null;
  readonly receiptVoucherNumber: string | null;
}

export interface ServiceProps extends Ladder {
  id: string;
  number: string;
  requestDate: string;
  sentTo: string;
  /** The vendor, when a supplier: the maintenance is payable to its ledger. */
  supplierId: string | null;
  note: string | null;
  status: 'pending' | 'approved' | 'closed' | 'rejected';
  lines: ServiceLine[];
  gatePassId: string | null;
  createdBy: string | null;
  createdAt: Date;
}

/**
 * Old WarrantyMaintenanceIndent: pieces sent out for warranty repair or maintenance, approved level by level;
 * final approval sends them out of stock with a gate pass, and they come back into stock when received, with
 * what the maintenance cost (the old receive had its own ladder; here the asset keepers receive them).
 */
export class ServiceRequest extends LadderDocument<ServiceProps> {
  protected readonly what = 'service_request';

  static open(params: {
    id: string;
    number: string;
    requestDate: string;
    sentTo: string;
    supplierId: string | null;
    note: string | null;
    lines: readonly Pick<ServiceLine, 'assetId' | 'serviceType' | 'problem' | 'cost'>[];
    levels: readonly ApprovalLevel[];
    createdBy: string;
    now: Date;
  }): ServiceRequest {
    const request = new ServiceRequest({
      id: params.id,
      number: params.number,
      requestDate: params.requestDate,
      sentTo: text(params.sentTo, 200, 'service provider', true)!,
      supplierId: params.supplierId,
      note: text(params.note, 1000, 'note'),
      status: 'pending',
      currentLevel: null,
      decisions: [],
      lines: assetLines(params.lines, 'service request').map((line, index) => ({
        ...line,
        problem: text(line.problem, 500, 'problem'),
        cost: line.serviceType === 'warranty' ? 0 : validAmount(line.cost, `Line ${index + 1}`),
        rejected: false,
        returnedOn: null,
        actualCost: null,
        receiptVoucherNumber: null,
      })),
      gatePassId: null,
      createdBy: params.createdBy,
      version: 1,
      createdAt: params.now,
      updatedAt: params.now,
    });
    request.startApproval(params.levels, 'service requests');
    return request;
  }

  static restore(props: ServiceProps): ServiceRequest {
    return new ServiceRequest({ ...props, lines: [...props.lines], decisions: [...props.decisions] });
  }

  get id(): string {
    return this.props.id;
  }
  get number(): string {
    return this.props.number;
  }
  get sentTo(): string {
    return this.props.sentTo;
  }
  get supplierId(): string | null {
    return this.props.supplierId;
  }
  get createdBy(): string | null {
    return this.props.createdBy;
  }
  get lines(): readonly ServiceLine[] {
    return this.props.lines;
  }

  /**
   * Approves at the current level, dropping the pieces named in `reject` (old per-line rejection). Returns the
   * pieces that go out when this was the final level, otherwise none.
   */
  approve(params: {
    level: ApprovalLevel;
    levels: readonly ApprovalLevel[];
    reject: readonly string[];
    by: string;
    remarks: string | null;
    now: Date;
  }): string[] {
    this.assertDecidable(params.level);
    this.props.lines = this.props.lines.map((line) =>
      params.reject.includes(line.assetId) ? { ...line, rejected: true } : line,
    );
    if (this.props.lines.every((line) => line.rejected)) {
      throw new DomainError('nothing_approved', 'Keep at least one piece, or reject the request');
    }
    const final = this.advance(params);
    if (final) this.props.status = 'approved';
    this.touch(params.now);
    return final ? this.props.lines.filter((line) => !line.rejected).map((line) => line.assetId) : [];
  }

  sentOut(gatePassId: string): void {
    this.props.gatePassId = gatePassId;
  }

  /**
   * Pieces back from service (old receive), with what each maintenance cost (`costs`; the expected cost when not
   * given, 0 for warranty); the request closes when every piece is back. Returns the cost to book.
   */
  receiveBack(params: {
    assetIds: readonly string[];
    costs: ReadonlyMap<string, number>;
    on: string;
    now: Date;
  }): number {
    if (this.props.status !== 'approved') {
      throw new DomainError('service_request_state', `A ${this.props.status} request has nothing out`);
    }
    if (params.on < this.props.requestDate) {
      throw new DomainError('invalid_date', 'Nothing comes back before it was sent');
    }
    const out = this.props.lines.filter((line) => !line.rejected && !line.returnedOn).map((line) => line.assetId);
    for (const id of [...params.assetIds, ...params.costs.keys()]) {
      if (!out.includes(id) || !params.assetIds.includes(id)) {
        throw new DomainError('not_out', 'A piece received is not out on this request');
      }
    }
    let total = 0;
    this.props.lines = this.props.lines.map((line, index) => {
      if (!params.assetIds.includes(line.assetId)) return line;
      const given = params.costs.get(line.assetId);
      if (line.serviceType === 'warranty' && (given ?? 0) > 0) {
        throw new DomainError('warranty_cost', `Line ${index + 1}: a warranty repair costs nothing`);
      }
      const actualCost = line.serviceType === 'warranty' ? 0 : validAmount(given ?? line.cost, `Line ${index + 1}`);
      total += paisa(actualCost);
      return { ...line, returnedOn: params.on, actualCost };
    });
    if (this.props.lines.every((line) => line.rejected || line.returnedOn)) this.props.status = 'closed';
    this.touch(params.now);
    return taka(total);
  }

  /** The voucher that booked the cost of the pieces just received. */
  booked(assetIds: readonly string[], voucherNumber: string): void {
    this.props.lines = this.props.lines.map((line) =>
      assetIds.includes(line.assetId) ? { ...line, receiptVoucherNumber: voucherNumber } : line,
    );
  }

  toSnapshot(): Readonly<ServiceProps> {
    return { ...this.props, lines: [...this.props.lines], decisions: [...this.props.decisions] };
  }
}

// Discard and sale

export interface DiscardLine {
  readonly assetId: string;
  readonly reason: string | null;
  readonly rejected: boolean;
  /** Set when sold (0 when given away or scrapped for nothing). */
  readonly saleAmount: number | null;
}

export interface DiscardProps extends Ladder {
  id: string;
  number: string;
  requestDate: string;
  reason: string;
  status: 'pending' | 'discarded' | 'sale_pending' | 'sold' | 'rejected';
  lines: DiscardLine[];
  discardedOn: string | null;
  soldOn: string | null;
  soldTo: string | null;
  /** The buyer's party ledger when the buyer is a supplier; otherwise the sale is cash. */
  buyerSupplierId: string | null;
  saleProposedBy: string | null;
  invoiceNo: string | null;
  createdBy: string | null;
  createdAt: Date;
}

/**
 * Old AssetDiscardIndent: pieces written off, approved level by level; final approval takes them out of stock
 * and the register (and closes their depreciation). Their sale is then proposed for every line at once (the old
 * serve also served lines without an amount at 0) and approved on its own ladder; the last level gives the
 * invoice number. A rejected sale goes back to discarded and may be proposed again.
 */
export class DiscardRequest extends LadderDocument<DiscardProps> {
  protected readonly what = 'discard_request';

  protected override get stage(): AssetDecision['stage'] {
    return this.props.status === 'sale_pending' ? 'sale' : 'request';
  }

  protected override get awaiting(): boolean {
    return this.props.status === 'pending' || this.props.status === 'sale_pending';
  }

  static open(params: {
    id: string;
    number: string;
    requestDate: string;
    reason: string;
    lines: readonly Pick<DiscardLine, 'assetId' | 'reason'>[];
    levels: readonly ApprovalLevel[];
    createdBy: string;
    now: Date;
  }): DiscardRequest {
    const request = new DiscardRequest({
      id: params.id,
      number: params.number,
      requestDate: params.requestDate,
      reason: text(params.reason, 500, 'reason', true)!,
      status: 'pending',
      currentLevel: null,
      decisions: [],
      lines: assetLines(params.lines, 'discard request').map((line) => ({
        ...line,
        reason: text(line.reason, 500, 'reason'),
        rejected: false,
        saleAmount: null,
      })),
      discardedOn: null,
      soldOn: null,
      soldTo: null,
      buyerSupplierId: null,
      saleProposedBy: null,
      invoiceNo: null,
      createdBy: params.createdBy,
      version: 1,
      createdAt: params.now,
      updatedAt: params.now,
    });
    request.startApproval(params.levels, 'discard requests');
    return request;
  }

  static restore(props: DiscardProps): DiscardRequest {
    return new DiscardRequest({ ...props, lines: [...props.lines], decisions: [...props.decisions] });
  }

  get id(): string {
    return this.props.id;
  }
  get number(): string {
    return this.props.number;
  }
  get createdBy(): string | null {
    return this.props.createdBy;
  }
  get lines(): readonly DiscardLine[] {
    return this.props.lines;
  }
  get soldOn(): string | null {
    return this.props.soldOn;
  }
  get soldTo(): string | null {
    return this.props.soldTo;
  }
  get buyerSupplierId(): string | null {
    return this.props.buyerSupplierId;
  }
  get saleProposedBy(): string | null {
    return this.props.saleProposedBy;
  }
  /** What the pieces are sold for. */
  get saleTotal(): number {
    return taka(this.props.lines.reduce((sum, line) => sum + paisa(line.saleAmount ?? 0), 0));
  }

  /** Returns the pieces written off when this was the final level. */
  approve(params: {
    level: ApprovalLevel;
    levels: readonly ApprovalLevel[];
    reject: readonly string[];
    by: string;
    remarks: string | null;
    on: string;
    now: Date;
  }): string[] {
    this.assertDecidable(params.level);
    if (this.props.status !== 'pending') {
      throw new DomainError('discard_request_state', 'The sale is decided on its own ladder');
    }
    this.props.lines = this.props.lines.map((line) =>
      params.reject.includes(line.assetId) ? { ...line, rejected: true } : line,
    );
    if (this.props.lines.every((line) => line.rejected)) {
      throw new DomainError('nothing_approved', 'Keep at least one piece, or reject the request');
    }
    const final = this.advance(params);
    if (final) {
      this.props.status = 'discarded';
      this.props.discardedOn = params.on;
    }
    this.touch(params.now);
    return final ? this.props.lines.filter((line) => !line.rejected).map((line) => line.assetId) : [];
  }

  /** Proposes the sale of the written-off pieces; `amounts`: piece → sale amount (0 or more). */
  proposeSale(params: {
    amounts: ReadonlyMap<string, number>;
    soldTo: string;
    buyerSupplierId: string | null;
    on: string;
    levels: readonly ApprovalLevel[];
    by: string;
    now: Date;
  }): void {
    if (this.props.status !== 'discarded') {
      throw new DomainError('discard_request_state', `A ${this.props.status.replace('_', ' ')} request cannot be sold`);
    }
    if (params.on < this.props.discardedOn!) throw new DomainError('invalid_date', 'A sale is not before the discard');
    const kept = this.props.lines.filter((line) => !line.rejected);
    for (const id of params.amounts.keys()) {
      if (!kept.some((line) => line.assetId === id))
        throw new DomainError('invalid_line', 'A piece sold is not discarded here');
    }
    const soldTo = text(params.soldTo, 200, 'buyer', true);
    this.startApproval(params.levels, 'discard sales');
    this.props.lines = this.props.lines.map((line, index) =>
      line.rejected
        ? line
        : { ...line, saleAmount: validAmount(params.amounts.get(line.assetId) ?? 0, `Line ${index + 1}`) },
    );
    this.props.soldOn = params.on;
    this.props.soldTo = soldTo;
    this.props.buyerSupplierId = params.buyerSupplierId;
    this.props.saleProposedBy = params.by;
    this.props.status = 'sale_pending';
    this.touch(params.now);
  }

  /** Approves the sale at the current level; returns true when this was the final level (then it is sold). */
  approveSale(params: {
    level: ApprovalLevel;
    levels: readonly ApprovalLevel[];
    by: string;
    remarks: string | null;
    now: Date;
  }): boolean {
    this.assertDecidable(params.level);
    if (this.props.status !== 'sale_pending') {
      throw new DomainError('discard_request_state', 'No sale is waiting for approval');
    }
    const final = this.advance(params);
    if (final) this.props.status = 'sold';
    this.touch(params.now);
    return final;
  }

  /** Rejecting the request, or only its sale: then the pieces stay written off and the sale may be proposed again. */
  override reject(params: { level: ApprovalLevel; by: string; remarks: string; now: Date }): void {
    if (this.props.status !== 'sale_pending') {
      super.reject(params);
      return;
    }
    this.assertDecidable(params.level);
    this.decide(params.level, 'rejected', params.by, validRemarks(params.remarks, true), params.now);
    this.props.status = 'discarded';
    this.props.currentLevel = null;
    this.props.lines = this.props.lines.map((line) => ({ ...line, saleAmount: null }));
    this.props.soldOn = null;
    this.props.soldTo = null;
    this.props.buyerSupplierId = null;
    this.props.saleProposedBy = null;
    this.touch(params.now);
  }

  setInvoice(invoiceNo: string): void {
    this.props.invoiceNo = invoiceNo;
  }

  toSnapshot(): Readonly<DiscardProps> {
    return { ...this.props, lines: [...this.props.lines], decisions: [...this.props.decisions] };
  }
}

// Scrap sale of things that are not registered assets

export interface ScrapLine {
  readonly description: string;
  readonly unit: string | null;
  readonly qty: number;
  readonly unitPrice: number;
  readonly total: number;
}

export interface ScrapProps extends Ladder {
  id: string;
  number: string;
  saleDate: string;
  buyer: string;
  /** The buyer's party ledger when the buyer is a supplier; otherwise the sale is cash. */
  buyerSupplierId: string | null;
  status: 'pending' | 'sold' | 'rejected';
  lines: ScrapLine[];
  total: number;
  invoiceNo: string | null;
  createdBy: string | null;
  createdAt: Date;
}

/**
 * Old ManualDiscardRequisition: scrap (cartons, broken furniture…) sold by description, approved level by level;
 * the final approval gives the invoice number and books the cash, or the buyer's party ledger (the old one
 * posted nothing).
 */
export class ScrapSale extends LadderDocument<ScrapProps> {
  protected readonly what = 'scrap_sale';

  static open(params: {
    id: string;
    number: string;
    saleDate: string;
    buyer: string;
    buyerSupplierId: string | null;
    lines: readonly Omit<ScrapLine, 'total'>[];
    levels: readonly ApprovalLevel[];
    createdBy: string;
    now: Date;
  }): ScrapSale {
    if (params.lines.length === 0 || params.lines.length > MAX_DOCUMENT_LINES) {
      throw new DomainError('invalid_lines', `A scrap sale has 1 to ${MAX_DOCUMENT_LINES} lines`);
    }
    const lines = params.lines.map((line, index) => {
      const at = `Line ${index + 1}`;
      validQuantity(line.qty, at);
      validAmount(line.unitPrice, at);
      return {
        description: text(line.description, 300, 'description', true)!,
        unit: text(line.unit, 30, 'unit'),
        qty: line.qty,
        unitPrice: line.unitPrice,
        total: taka(paisa(line.qty * line.unitPrice)),
      };
    });
    const sale = new ScrapSale({
      id: params.id,
      number: params.number,
      saleDate: params.saleDate,
      buyer: text(params.buyer, 200, 'buyer', true)!,
      buyerSupplierId: params.buyerSupplierId,
      status: 'pending',
      currentLevel: null,
      decisions: [],
      lines,
      total: taka(lines.reduce((sum, line) => sum + paisa(line.total), 0)),
      invoiceNo: null,
      createdBy: params.createdBy,
      version: 1,
      createdAt: params.now,
      updatedAt: params.now,
    });
    sale.startApproval(params.levels, 'scrap sales');
    return sale;
  }

  static restore(props: ScrapProps): ScrapSale {
    return new ScrapSale({ ...props, lines: [...props.lines], decisions: [...props.decisions] });
  }

  get id(): string {
    return this.props.id;
  }
  get number(): string {
    return this.props.number;
  }
  get total(): number {
    return this.props.total;
  }
  get saleDate(): string {
    return this.props.saleDate;
  }
  get buyer(): string {
    return this.props.buyer;
  }
  get buyerSupplierId(): string | null {
    return this.props.buyerSupplierId;
  }
  get createdBy(): string | null {
    return this.props.createdBy;
  }

  /** Returns true when this was the final level (then the invoice number is given and the cash booked). */
  approve(params: {
    level: ApprovalLevel;
    levels: readonly ApprovalLevel[];
    by: string;
    remarks: string | null;
    now: Date;
  }): boolean {
    const final = this.advance(params);
    if (final) this.props.status = 'sold';
    this.touch(params.now);
    return final;
  }

  setInvoice(invoiceNo: string): void {
    this.props.invoiceNo = invoiceNo;
  }

  toSnapshot(): Readonly<ScrapProps> {
    return { ...this.props, lines: [...this.props.lines], decisions: [...this.props.decisions] };
  }
}
