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

export type RequisitionStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'cancelled';
export type PaymentTerm = 'cash' | 'credit';

export interface RequisitionLine {
  readonly variantId: string;
  readonly requestedQty: number;
  /** Set by approvers; starts as the requested quantity at the first approval. */
  readonly approvedQty: number | null;
  readonly description: string | null;
}

export interface RequisitionHeader {
  readonly mainStoreId: string;
  readonly subStoreId: string | null;
  readonly departmentId: string | null;
  /** The supplier suggested by the requester (old PR SupplierId); the order may go to another. */
  readonly supplierId: string | null;
  readonly requisitionDate: string;
  readonly paymentTerm: PaymentTerm | null;
  readonly note: string | null;
  readonly terms: string | null;
}

export interface RequisitionProps extends RequisitionHeader {
  id: string;
  number: string;
  status: RequisitionStatus;
  /** The level that decides next, while pending. */
  currentLevel: number | null;
  lines: RequisitionLine[];
  decisions: Decision[];
  createdBy: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

function validLines(lines: readonly RequisitionLine[]): RequisitionLine[] {
  return validLineSet(lines, (line) => line.variantId, 'requisition').map((line, index) => {
    validQuantity(line.requestedQty, `Line ${index + 1}`);
    if (line.description && line.description.length > 300) {
      throw new DomainError('invalid_description', `Line ${index + 1}: the description is at most 300 characters`);
    }
    return { ...line, approvedQty: null };
  });
}

/**
 * Old PurchaseRequisiontion: drafted, submitted, then approved level by level by the roles set up for the
 * main store (old SCMPurchaseApprovalSettings). Each approver may lower the approved quantities. The old
 * screens had no rejection; it is added here.
 */
export class PurchaseRequisition {
  private constructor(private readonly props: RequisitionProps) {}

  static draft(params: {
    id: string;
    number: string;
    header: RequisitionHeader;
    lines: readonly RequisitionLine[];
    createdBy: string;
    now: Date;
  }): PurchaseRequisition {
    return new PurchaseRequisition({
      id: params.id,
      number: params.number,
      ...params.header,
      status: 'draft',
      currentLevel: null,
      lines: validLines(params.lines),
      decisions: [],
      createdBy: params.createdBy,
      version: 1,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  static restore(props: RequisitionProps): PurchaseRequisition {
    return new PurchaseRequisition({ ...props, lines: [...props.lines], decisions: [...props.decisions] });
  }

  get id(): string {
    return this.props.id;
  }
  get status(): RequisitionStatus {
    return this.props.status;
  }
  get mainStoreId(): string {
    return this.props.mainStoreId;
  }
  get currentLevel(): number | null {
    return this.props.currentLevel;
  }
  get lines(): readonly RequisitionLine[] {
    return this.props.lines;
  }

  edit(changes: { header?: Partial<RequisitionHeader>; lines?: readonly RequisitionLine[] }, now: Date): void {
    this.assertStatus(['draft'], 'edited');
    Object.assign(this.props, changes.header);
    if (changes.lines) this.props.lines = validLines(changes.lines);
    this.touch(now);
  }

  submit(levels: readonly ApprovalLevel[], now: Date): void {
    this.assertStatus(['draft'], 'submitted');
    this.props.currentLevel = firstLevel(levels, 'this main store').order;
    this.props.status = 'pending';
    this.touch(now);
  }

  /**
   * Approves at the current level. `quantities` (variant → approved quantity, 0 drops the line) may lower
   * what was asked for, never raise it; lines left out keep their quantity.
   */
  approve(params: {
    level: ApprovalLevel;
    levels: readonly ApprovalLevel[];
    quantities: ReadonlyMap<string, number>;
    by: string;
    remarks: string | null;
    now: Date;
  }): void {
    this.assertDecidable(params.level);
    this.props.lines = approvedLines(this.props.lines, params.quantities, (line) => line.requestedQty, 'requisition');
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

  /** Drafts and pending ones; an approved requisition only while no order uses it (checked by the caller). */
  cancel(now: Date): void {
    this.assertStatus(['draft', 'pending', 'approved'], 'cancelled');
    this.props.status = 'cancelled';
    this.props.currentLevel = null;
    this.touch(now);
  }

  assertDeletable(): void {
    this.assertStatus(['draft'], 'deleted');
  }

  assertVersion(version: number): void {
    if (version !== this.props.version) {
      throw new ConflictError('stale_requisition', 'The requisition was changed by someone else; reload it');
    }
  }

  toSnapshot(): Readonly<RequisitionProps> {
    return { ...this.props, lines: [...this.props.lines], decisions: [...this.props.decisions] };
  }

  private assertDecidable(level: ApprovalLevel): void {
    this.assertStatus(['pending'], 'decided');
    if (level.order !== this.props.currentLevel) {
      throw new DomainError('wrong_level', 'The requisition is waiting for another approval level');
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

  private assertStatus(allowed: readonly RequisitionStatus[], action: string): void {
    if (!allowed.includes(this.props.status)) {
      throw new DomainError('requisition_state', `A ${this.props.status} requisition cannot be ${action}`);
    }
  }

  private touch(now: Date): void {
    this.props.version += 1;
    this.props.updatedAt = now;
  }
}
