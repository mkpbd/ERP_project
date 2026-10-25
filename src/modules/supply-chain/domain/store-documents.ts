import { ConflictError, DomainError } from '../../../shared/domain/errors.js';
import {
  approvedLines,
  firstLevel,
  nextLevel,
  validLineSet,
  validQuantity,
  validRemarks,
  type ApprovalLevel,
  type Decision,
} from './documents.js';

const qty3 = (value: number) => Math.round(value * 1000) / 1000;

function validText(value: string | null, max: number, what: string, at: string): string | null {
  const text = value?.trim() ?? '';
  if (text.length > max) throw new DomainError('invalid_text', `${at}: the ${what} is at most ${max} characters`);
  return text.length > 0 ? text : null;
}

/**
 * Serves quantities (variant → quantity) against lines with a cap: never beyond what is still open.
 * Returns the lines with their served quantity raised.
 */
function served<T extends { readonly variantId: string; readonly servedQty: number }>(
  lines: readonly T[],
  quantities: ReadonlyMap<string, number>,
  cap: (line: T) => number,
  what: string,
): T[] {
  for (const variantId of quantities.keys()) {
    if (!lines.some((line) => line.variantId === variantId)) {
      throw new DomainError('not_on_document', `An item served is not on the ${what}`);
    }
  }
  return lines.map((line, index) => {
    const total = qty3(line.servedQty + (quantities.get(line.variantId) ?? 0));
    if (total > cap(line)) {
      throw new DomainError(
        'serve_exceeds_request',
        `Line ${index + 1}: only ${qty3(cap(line) - line.servedQty)} is still open on the ${what}`,
      );
    }
    return { ...line, servedQty: total };
  });
}

// Store indents

export type IndentStatus =
  'draft' | 'pending' | 'approved' | 'partially_served' | 'served' | 'acknowledged' | 'rejected' | 'cancelled';
export const INDENT_PRIORITIES = [
  'routine',
  'emergency',
  'critical_care',
  'new_admission',
  'discharge',
  'other',
] as const;
export type IndentPriority = (typeof INDENT_PRIORITIES)[number];

export interface IndentLine {
  readonly variantId: string;
  readonly qty: number;
  readonly approvedQty: number | null;
  readonly servedQty: number;
  readonly remarks: string | null;
}

export interface IndentHeader {
  readonly subStoreId: string;
  /** The department the goods are for (the old indent never recorded it; the issue did). */
  readonly departmentId: string | null;
  readonly indentDate: string;
  readonly priority: IndentPriority;
  readonly note: string | null;
}

export interface IndentProps extends IndentHeader {
  id: string;
  number: string;
  status: IndentStatus;
  currentLevel: number | null;
  lines: IndentLine[];
  decisions: Decision[];
  createdBy: string | null;
  acknowledgedBy: string | null;
  acknowledgedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export type IndentLineInput = Pick<IndentLine, 'variantId' | 'qty' | 'remarks'>;

function validIndentLines(lines: readonly IndentLineInput[]): IndentLine[] {
  return validLineSet(lines, (line) => line.variantId, 'indent').map((line, index) => ({
    variantId: line.variantId,
    qty: validQuantity(line.qty, `Line ${index + 1}`),
    approvedQty: null,
    servedQty: 0,
    remarks: validText(line.remarks, 300, 'remark', `Line ${index + 1}`),
  }));
}

/**
 * Old StoreIndent: a sub-store's request for goods, approved level by level by the roles set up for the
 * sub-store (old StoreIndentApprovalSettings), then served by issues. The old approval marked the indent
 * approved after the first level, so later levels never saw it; here every level decides in turn, and an
 * indent can be rejected. The person who raised it acknowledges receipt once it is served.
 */
export class StoreIndent {
  private constructor(private readonly props: IndentProps) {}

  static draft(params: {
    id: string;
    number: string;
    header: IndentHeader;
    lines: readonly IndentLineInput[];
    createdBy: string;
    now: Date;
  }): StoreIndent {
    return new StoreIndent({
      id: params.id,
      number: params.number,
      ...params.header,
      note: validText(params.header.note, 1000, 'note', 'Indent'),
      status: 'draft',
      currentLevel: null,
      lines: validIndentLines(params.lines),
      decisions: [],
      createdBy: params.createdBy,
      acknowledgedBy: null,
      acknowledgedAt: null,
      version: 1,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  static restore(props: IndentProps): StoreIndent {
    return new StoreIndent({ ...props, lines: [...props.lines], decisions: [...props.decisions] });
  }

  get id(): string {
    return this.props.id;
  }
  get number(): string {
    return this.props.number;
  }
  get status(): IndentStatus {
    return this.props.status;
  }
  get subStoreId(): string {
    return this.props.subStoreId;
  }
  get departmentId(): string | null {
    return this.props.departmentId;
  }
  get currentLevel(): number | null {
    return this.props.currentLevel;
  }
  get createdBy(): string | null {
    return this.props.createdBy;
  }
  get lines(): readonly IndentLine[] {
    return this.props.lines;
  }

  edit(changes: { header?: Partial<IndentHeader>; lines?: readonly IndentLineInput[] }, now: Date): void {
    this.assertStatus(['draft'], 'edited');
    const header = { ...this.props, ...changes.header };
    Object.assign(this.props, header, { note: validText(header.note, 1000, 'note', 'Indent') });
    if (changes.lines) this.props.lines = validIndentLines(changes.lines);
    this.touch(now);
  }

  submit(levels: readonly ApprovalLevel[], now: Date): void {
    this.assertStatus(['draft'], 'submitted');
    this.props.currentLevel = firstLevel(levels, 'this sub-store').order;
    this.props.status = 'pending';
    this.touch(now);
  }

  approve(params: {
    level: ApprovalLevel;
    levels: readonly ApprovalLevel[];
    quantities: ReadonlyMap<string, number>;
    by: string;
    remarks: string | null;
    now: Date;
  }): void {
    this.assertDecidable(params.level);
    this.props.lines = approvedLines(this.props.lines, params.quantities, (line) => line.qty, 'indent');
    this.decide(params.level, 'approved', params.by, validRemarks(params.remarks, false), params.now);
    const next = nextLevel(params.levels, params.level);
    this.props.currentLevel = next?.order ?? null;
    if (!next) this.props.status = 'approved';
    this.touch(params.now);
  }

  reject(params: { level: ApprovalLevel; by: string; remarks: string; now: Date }): void {
    this.assertDecidable(params.level);
    this.decide(params.level, 'rejected', params.by, validRemarks(params.remarks, true), params.now);
    this.props.status = 'rejected';
    this.props.currentLevel = null;
    this.touch(params.now);
  }

  /** Issued quantities (variant → quantity), never beyond the approved quantity. */
  serve(quantities: ReadonlyMap<string, number>, now: Date): void {
    this.assertStatus(['approved', 'partially_served'], 'served');
    this.props.lines = served(this.props.lines, quantities, (line) => line.approvedQty ?? 0, 'indent');
    this.props.status = this.props.lines.every((line) => line.servedQty >= (line.approvedQty ?? 0))
      ? 'served'
      : 'partially_served';
    this.touch(now);
  }

  /** Stops waiting for the rest of a partly served indent, or drops one not served at all. */
  cancel(now: Date): void {
    this.assertStatus(['draft', 'pending', 'approved', 'partially_served'], 'cancelled');
    this.props.status = 'cancelled';
    this.props.currentLevel = null;
    this.touch(now);
  }

  /** Old acknowledgement: the person who raised the indent confirms the goods arrived. */
  acknowledge(by: string, now: Date): void {
    this.assertStatus(['served'], 'acknowledged');
    this.props.status = 'acknowledged';
    this.props.acknowledgedBy = by;
    this.props.acknowledgedAt = now;
    this.touch(now);
  }

  /** What is approved and not yet issued, by variant. */
  open(): Map<string, number> {
    return new Map(
      this.props.lines
        .map((line) => [line.variantId, qty3((line.approvedQty ?? 0) - line.servedQty)] as const)
        .filter(([, qty]) => qty > 0),
    );
  }

  assertDeletable(): void {
    this.assertStatus(['draft'], 'deleted');
  }

  assertVersion(version: number): void {
    if (version !== this.props.version) {
      throw new ConflictError('stale_store_indent', 'The indent was changed by someone else; reload it');
    }
  }

  toSnapshot(): Readonly<IndentProps> {
    return { ...this.props, lines: [...this.props.lines], decisions: [...this.props.decisions] };
  }

  private assertDecidable(level: ApprovalLevel): void {
    this.assertStatus(['pending'], 'decided');
    if (level.order !== this.props.currentLevel) {
      throw new DomainError('wrong_level', 'The indent is waiting for another approval level');
    }
  }

  private decide(level: ApprovalLevel, decision: Decision['decision'], by: string, remarks: string | null, now: Date) {
    this.props.decisions.push({
      levelOrder: level.order,
      levelName: level.name,
      decision,
      decidedBy: by,
      decidedAt: now,
      remarks,
    });
  }

  private assertStatus(allowed: readonly IndentStatus[], action: string): void {
    if (!allowed.includes(this.props.status)) {
      throw new DomainError(
        'store_indent_state',
        `A ${this.props.status.replace('_', ' ')} indent cannot be ${action}`,
      );
    }
  }

  private touch(now: Date): void {
    this.props.version += 1;
    this.props.updatedAt = now;
  }
}

// Store requests

export type RequestStatus = 'open' | 'partially_served' | 'served' | 'closed';

export interface RequestLine {
  readonly variantId: string;
  readonly qty: number;
  readonly servedQty: number;
}

export interface RequestProps {
  id: string;
  number: string;
  subStoreId: string;
  mainStoreId: string;
  requestDate: string;
  note: string | null;
  status: RequestStatus;
  purchaseRequisitionId: string | null;
  lines: RequestLine[];
  createdBy: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Old PRIndent: a sub-store asks its main store for what it cannot give from its own stock. The main store
 * serves it with transfers, or raises a purchase requisition for it (old PRSubmitted). The old page made one
 * request out of every store's shortfalls under the first store, and marked it served even when short lines
 * were never sent.
 */
export class StoreRequest {
  private constructor(private readonly props: RequestProps) {}

  static open(params: {
    id: string;
    number: string;
    subStoreId: string;
    mainStoreId: string;
    requestDate: string;
    note: string | null;
    lines: readonly Pick<RequestLine, 'variantId' | 'qty'>[];
    createdBy: string;
    now: Date;
  }): StoreRequest {
    return new StoreRequest({
      id: params.id,
      number: params.number,
      subStoreId: params.subStoreId,
      mainStoreId: params.mainStoreId,
      requestDate: params.requestDate,
      note: validText(params.note, 1000, 'note', 'Request'),
      status: 'open',
      purchaseRequisitionId: null,
      lines: validLineSet(params.lines, (line) => line.variantId, 'store request').map((line, index) => ({
        variantId: line.variantId,
        qty: validQuantity(line.qty, `Line ${index + 1}`),
        servedQty: 0,
      })),
      createdBy: params.createdBy,
      version: 1,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  static restore(props: RequestProps): StoreRequest {
    return new StoreRequest({ ...props, lines: [...props.lines] });
  }

  get id(): string {
    return this.props.id;
  }
  get number(): string {
    return this.props.number;
  }
  get status(): RequestStatus {
    return this.props.status;
  }
  get subStoreId(): string {
    return this.props.subStoreId;
  }
  get mainStoreId(): string {
    return this.props.mainStoreId;
  }
  get lines(): readonly RequestLine[] {
    return this.props.lines;
  }

  serve(quantities: ReadonlyMap<string, number>, now: Date): void {
    this.assertOpen('served');
    this.props.lines = served(this.props.lines, quantities, (line) => line.qty, 'store request');
    this.props.status = this.props.lines.every((line) => line.servedQty >= line.qty) ? 'served' : 'partially_served';
    this.touch(now);
  }

  /** What is still to be served, by variant. */
  outstanding(): Map<string, number> {
    return new Map(
      this.props.lines
        .map((line) => [line.variantId, qty3(line.qty - line.servedQty)] as const)
        .filter(([, qty]) => qty > 0),
    );
  }

  linkPurchase(requisitionId: string, now: Date): void {
    this.assertOpen('sent to purchase');
    if (this.props.purchaseRequisitionId) {
      throw new DomainError('already_requested', 'A purchase requisition was already raised for this request');
    }
    this.props.purchaseRequisitionId = requisitionId;
    this.touch(now);
  }

  close(now: Date): void {
    this.assertOpen('closed');
    this.props.status = 'closed';
    this.touch(now);
  }

  assertVersion(version: number): void {
    if (version !== this.props.version) {
      throw new ConflictError('stale_store_request', 'The request was changed by someone else; reload it');
    }
  }

  toSnapshot(): Readonly<RequestProps> {
    return { ...this.props, lines: [...this.props.lines] };
  }

  private assertOpen(action: string): void {
    if (this.props.status !== 'open' && this.props.status !== 'partially_served') {
      throw new DomainError('store_request_state', `A ${this.props.status} request cannot be ${action}`);
    }
  }

  private touch(now: Date): void {
    this.props.version += 1;
    this.props.updatedAt = now;
  }
}

// Issues and transfers (posted documents; their lots are in the stock movements)

export interface MoveLine {
  readonly variantId: string;
  readonly qty: number;
  /** Take from this lot only; otherwise first expiring first. */
  readonly lotId: string | null;
}

/** Lines of an issue or transfer: an item may appear again only for another lot. */
export function validMoveLines(lines: readonly MoveLine[], what: string): MoveLine[] {
  return validLineSet(lines, (line) => `${line.variantId}|${line.lotId ?? ''}`, what).map((line, index) => ({
    ...line,
    qty: validQuantity(line.qty, `Line ${index + 1}`),
  }));
}

/** Variant → total quantity of the lines. */
export function quantitiesOf(lines: readonly { variantId: string; qty: number }[]): Map<string, number> {
  const quantities = new Map<string, number>();
  for (const line of lines) quantities.set(line.variantId, qty3((quantities.get(line.variantId) ?? 0) + line.qty));
  return quantities;
}

export type TransferKind = 'main_to_sub' | 'sub_to_main' | 'sub_to_sub';
export type TransferStatus = 'pending' | 'completed' | 'rejected';

/**
 * Store-to-store transfers wait for the receiving store (old SCMStockTransfer Pending → Accepted / Rejected);
 * the receiver may accept less than was sent. Transfers from or to a main store complete at once, as before.
 */
export function acceptedLines(
  lines: readonly (MoveLine & { acceptedQty: number | null })[],
  accepted: ReadonlyMap<number, number>,
): (MoveLine & { acceptedQty: number })[] {
  for (const position of accepted.keys()) {
    if (!lines[position]) throw new DomainError('invalid_line', `There is no line ${position + 1}`);
  }
  const result = lines.map((line, index) => {
    const qty = accepted.get(index) ?? line.qty;
    validQuantity(qty, `Line ${index + 1}`, true);
    if (qty > line.qty)
      throw new DomainError('accept_exceeds_transfer', `Line ${index + 1}: more than sent is accepted`);
    return { ...line, acceptedQty: qty };
  });
  if (result.every((line) => line.acceptedQty === 0)) {
    throw new DomainError('nothing_accepted', 'Accept at least one line, or reject the transfer');
  }
  return result;
}
