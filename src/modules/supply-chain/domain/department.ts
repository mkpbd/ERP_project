import { ConflictError, DomainError, ForbiddenError } from '../../../shared/domain/errors.js';
import { validLineSet, validQuantity, validRemarks } from './documents.js';
import { validMoveLines, type MoveLine } from './store-documents.js';

const qty3 = (value: number) => Math.round(value * 1000) / 1000;

function validNote(note: string | null, what: string): string | null {
  const text = note?.trim() ?? '';
  if (text.length > 500) throw new DomainError('invalid_text', `The ${what} is at most 500 characters`);
  return text.length > 0 ? text : null;
}

interface Versioned {
  version: number;
  updatedAt: Date;
}

function touch(props: Versioned, now: Date): void {
  props.version += 1;
  props.updatedAt = now;
}

function assertVersion(props: Versioned, version: number, code: string): void {
  if (props.version !== version) throw new ConflictError(code, 'The document was changed by someone else; reload it');
}

// Consumption

export interface ConsumptionProps extends Versioned {
  id: string;
  number: string;
  departmentId: string;
  consumedOn: string;
  note: string | null;
  status: 'posted' | 'cancelled';
  lines: MoveLine[];
  createdBy: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  createdAt: Date;
}

/**
 * Old DeptStockConsumption: what a department used up, out of its stock at once (first expiring first,
 * expired lots left out unless named). Cancelling puts the same lots back.
 */
export class DepartmentConsumption {
  private constructor(private readonly props: ConsumptionProps) {}

  static post(params: {
    id: string;
    number: string;
    departmentId: string;
    consumedOn: string;
    note: string | null;
    lines: readonly MoveLine[];
    createdBy: string;
    now: Date;
  }): DepartmentConsumption {
    return new DepartmentConsumption({
      id: params.id,
      number: params.number,
      departmentId: params.departmentId,
      consumedOn: params.consumedOn,
      note: validNote(params.note, 'note'),
      status: 'posted',
      lines: validMoveLines(params.lines, 'consumption'),
      createdBy: params.createdBy,
      cancelledBy: null,
      cancelReason: null,
      version: 1,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  static restore(props: ConsumptionProps): DepartmentConsumption {
    return new DepartmentConsumption({ ...props, lines: [...props.lines] });
  }

  get id(): string {
    return this.props.id;
  }
  get number(): string {
    return this.props.number;
  }
  get departmentId(): string {
    return this.props.departmentId;
  }
  get lines(): readonly MoveLine[] {
    return this.props.lines;
  }

  cancel(by: string, reason: string, now: Date): void {
    if (this.props.status !== 'posted')
      throw new DomainError('consumption_state', 'The consumption is already cancelled');
    const cancelReason = validRemarks(reason, true);
    this.props.status = 'cancelled';
    this.props.cancelledBy = by;
    this.props.cancelReason = cancelReason;
    touch(this.props, now);
  }

  assertVersion(version: number): void {
    assertVersion(this.props, version, 'stale_consumption');
  }

  toSnapshot(): Readonly<ConsumptionProps> {
    return { ...this.props, lines: [...this.props.lines] };
  }
}

// Returns to a sub-store

export type ReturnStatus = 'pending' | 'received' | 'cancelled';

export interface ReturnProps extends Versioned {
  id: string;
  number: string;
  departmentId: string;
  subStoreId: string;
  returnDate: string;
  reason: string | null;
  status: ReturnStatus;
  lines: MoveLine[];
  receivedOn: string | null;
  receivedBy: string | null;
  createdBy: string | null;
  createdAt: Date;
}

/**
 * Old DeptStockReturn: a department sends goods back to a sub-store. Nothing moves until the store receives
 * them; then the lots go from the department to the store (expired lots too: they come back to be dealt with).
 * The old return reserved the stock while pending; here the stock is checked again when received.
 */
export class DepartmentReturn {
  private constructor(private readonly props: ReturnProps) {}

  static open(params: {
    id: string;
    number: string;
    departmentId: string;
    subStoreId: string;
    returnDate: string;
    reason: string | null;
    lines: readonly MoveLine[];
    createdBy: string;
    now: Date;
  }): DepartmentReturn {
    return new DepartmentReturn({
      id: params.id,
      number: params.number,
      departmentId: params.departmentId,
      subStoreId: params.subStoreId,
      returnDate: params.returnDate,
      reason: validNote(params.reason, 'reason'),
      status: 'pending',
      lines: validMoveLines(params.lines, 'return'),
      receivedOn: null,
      receivedBy: null,
      createdBy: params.createdBy,
      version: 1,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  static restore(props: ReturnProps): DepartmentReturn {
    return new DepartmentReturn({ ...props, lines: [...props.lines] });
  }

  get id(): string {
    return this.props.id;
  }
  get number(): string {
    return this.props.number;
  }
  get departmentId(): string {
    return this.props.departmentId;
  }
  get subStoreId(): string {
    return this.props.subStoreId;
  }
  get lines(): readonly MoveLine[] {
    return this.props.lines;
  }

  receive(by: string, on: string, now: Date): void {
    this.assertPending('received');
    if (on < this.props.returnDate) throw new DomainError('invalid_date', 'A return is not received before it is sent');
    this.props.status = 'received';
    this.props.receivedOn = on;
    this.props.receivedBy = by;
    touch(this.props, now);
  }

  cancel(now: Date): void {
    this.assertPending('cancelled');
    this.props.status = 'cancelled';
    touch(this.props, now);
  }

  assertVersion(version: number): void {
    assertVersion(this.props, version, 'stale_department_return');
  }

  toSnapshot(): Readonly<ReturnProps> {
    return { ...this.props, lines: [...this.props.lines] };
  }

  private assertPending(action: string): void {
    if (this.props.status !== 'pending') {
      throw new DomainError('department_return_state', `A ${this.props.status} return cannot be ${action}`);
    }
  }
}

// Stock counts

export type AdjustmentStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface CountLine {
  readonly variantId: string;
  readonly lotId: string;
  /** What the department's records showed when counted. */
  readonly systemQty: number;
  readonly physicalQty: number;
  /** Physical − records at approval (null until then). */
  readonly adjustQty: number | null;
}

export interface AdjustmentProps extends Versioned {
  id: string;
  number: string;
  departmentId: string;
  countedOn: string;
  reason: string;
  status: AdjustmentStatus;
  lines: CountLine[];
  createdBy: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionRemarks: string | null;
  createdAt: Date;
}

/**
 * Old DeptStockAdjustment: a department's physical count by lot; once someone other than the requester approves
 * it, each lot is set to what was counted (the difference is worked out again at approval, as before).
 */
export class DepartmentAdjustment {
  private constructor(private readonly props: AdjustmentProps) {}

  static request(params: {
    id: string;
    number: string;
    departmentId: string;
    countedOn: string;
    reason: string;
    lines: readonly Omit<CountLine, 'adjustQty'>[];
    createdBy: string;
    now: Date;
  }): DepartmentAdjustment {
    const lines = validLineSet(params.lines, (line) => line.lotId, 'stock count').map((line, index) => ({
      ...line,
      physicalQty: validQuantity(line.physicalQty, `Line ${index + 1}`, true),
      adjustQty: null,
    }));
    return new DepartmentAdjustment({
      id: params.id,
      number: params.number,
      departmentId: params.departmentId,
      countedOn: params.countedOn,
      reason: validRemarks(params.reason, true)!,
      status: 'pending',
      lines,
      createdBy: params.createdBy,
      decidedBy: null,
      decidedAt: null,
      decisionRemarks: null,
      version: 1,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  static restore(props: AdjustmentProps): DepartmentAdjustment {
    return new DepartmentAdjustment({ ...props, lines: [...props.lines] });
  }

  get id(): string {
    return this.props.id;
  }
  get number(): string {
    return this.props.number;
  }
  get departmentId(): string {
    return this.props.departmentId;
  }
  get countedOn(): string {
    return this.props.countedOn;
  }
  get lines(): readonly CountLine[] {
    return this.props.lines;
  }

  /** `current`: lot → what the records show now. Returns the lines with their adjustment. */
  approve(params: {
    by: string;
    current: ReadonlyMap<string, number>;
    remarks: string | null;
    now: Date;
  }): CountLine[] {
    this.assertDecidable(params.by);
    this.props.lines = this.props.lines.map((line) => ({
      ...line,
      adjustQty: qty3(line.physicalQty - (params.current.get(line.lotId) ?? 0)),
    }));
    this.decide('approved', params.by, validRemarks(params.remarks, false), params.now);
    return this.props.lines;
  }

  reject(params: { by: string; remarks: string; now: Date }): void {
    this.assertDecidable(params.by);
    this.decide('rejected', params.by, validRemarks(params.remarks, true), params.now);
  }

  cancel(now: Date): void {
    if (this.props.status !== 'pending') {
      throw new DomainError('adjustment_state', `A ${this.props.status} count cannot be cancelled`);
    }
    this.props.status = 'cancelled';
    touch(this.props, now);
  }

  assertVersion(version: number): void {
    assertVersion(this.props, version, 'stale_adjustment');
  }

  toSnapshot(): Readonly<AdjustmentProps> {
    return { ...this.props, lines: [...this.props.lines] };
  }

  private assertDecidable(by: string): void {
    if (this.props.status !== 'pending') {
      throw new DomainError('adjustment_state', `A ${this.props.status} count cannot be decided`);
    }
    if (this.props.createdBy === by) {
      throw new ForbiddenError('self_approval', 'Someone other than the person who counted decides the count');
    }
  }

  private decide(status: 'approved' | 'rejected', by: string, remarks: string | null, now: Date): void {
    this.props.status = status;
    this.props.decidedBy = by;
    this.props.decidedAt = now;
    this.props.decisionRemarks = remarks;
    touch(this.props, now);
  }
}
