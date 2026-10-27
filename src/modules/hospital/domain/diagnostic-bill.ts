import { ConflictError, DomainError, ForbiddenError } from '../../../shared/domain/errors.js';
import { validMoney, type BillPayer, type PaymentMethod } from './opd-bill.js';
import { text } from './patient.js';

export const MAX_DIAGNOSTIC_LINES = 60;
const paisa = (value: number) => Math.round(value * 100);
const taka = (paisas: number) => paisas / 100;
const sum = (amounts: readonly number[]) => taka(amounts.reduce((total, amount) => total + paisa(amount), 0));

export type DiagnosticStatus = 'billed' | 'cancelled';

/** A test on the bill. */
export interface DiagnosticLine {
  readonly testId: string;
  readonly packageId: string | null;
  readonly rate: number;
  readonly discountAllowed: boolean;
  /** Its part of the bill's discount. */
  readonly discount: number;
  readonly referralPercent: number;
  /** The referring doctor's commission on the rate (none without a referring doctor). */
  readonly referralAmount: number;
  readonly reportDueAt: Date | null;
  readonly status: DiagnosticStatus;
  readonly cancelledOn: string | null;
  readonly cancelReason: string | null;
}

export interface DiagnosticBillProps {
  id: string;
  number: string;
  patientId: string;
  billedOn: string;
  billedAt: Date;
  referredById: string | null;
  corporateClientId: string | null;
  staffId: string | null;
  admissionId: string | null;
  gross: number;
  discount: number;
  discountReason: string | null;
  net: number;
  cancelled: number;
  paid: number;
  collected: number;
  refunded: number;
  status: DiagnosticStatus;
  voucherNumber: string | null;
  billedBy: string | null;
  lines: DiagnosticLine[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Shares `amount` (paisa) over `weights` in proportion, the remainders to the largest fractions. */
function shareOut(amount: number, weights: readonly number[]): number[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total === 0) return weights.map(() => 0);
  const exact = weights.map((weight) => (amount * weight) / total);
  const parts = exact.map(Math.floor);
  let left = amount - parts.reduce((sum, part) => sum + part, 0);
  const order = exact
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest);
  for (const { index } of order) {
    if (left <= 0) break;
    parts[index]! += 1;
    left -= 1;
  }
  return parts;
}

/**
 * Old Investigation Invoice (CreateInvestigationInvoiceFullCommand: the due worked out from a ledger each time, a
 * discount per line up to the discount category's maximum, the referral commission worked out later by a stored
 * procedure): tests billed to a registered patient at their rates (a package's tests at the package's rates), each
 * with when its report is due. The discount is on the tests that may be discounted, limited at the counter; the
 * referring doctor earns their commission on each test as it is billed. Tests are cancelled one by one or all
 * together, the money beyond what is left given back.
 */
export class DiagnosticBill {
  private constructor(private readonly props: DiagnosticBillProps) {}

  static create(params: {
    id: string;
    number: string;
    patientId: string;
    billedOn: string;
    referredById: string | null;
    payer: BillPayer;
    /** An admitted patient's tests: charged to the stay, with no discount or payment here. */
    admissionId?: string | null;
    lines: readonly {
      testId: string;
      packageId: string | null;
      rate: number;
      discountAllowed: boolean;
      referralPercent: number;
      reportHours: number | null;
    }[];
    discount: number;
    discountReason: string | null;
    discountLimitPercent: number;
    mayDiscountMore: boolean;
    payment: { method: PaymentMethod; amount: number } | null;
    by: string;
    now: Date;
  }): DiagnosticBill {
    if (params.lines.length === 0 || params.lines.length > MAX_DIAGNOSTIC_LINES) {
      throw new DomainError('invalid_lines', `A bill has 1 to ${MAX_DIAGNOSTIC_LINES} tests`);
    }
    const seen = new Set<string>();
    for (const [index, line] of params.lines.entries()) {
      if (seen.has(line.testId)) throw new DomainError('duplicate_test', `Test ${index + 1} is on the bill already`);
      seen.add(line.testId);
      validMoney(line.rate, 'rate');
    }
    const admissionId = params.admissionId ?? null;
    if (admissionId && (params.payer.kind !== 'patient' || params.discount > 0 || params.payment)) {
      throw new DomainError(
        'indoor_bill',
        "An admitted patient's tests are charged to the stay: no payer, discount or payment here",
      );
    }
    const gross = sum(params.lines.map((line) => line.rate));
    const discountable = sum(params.lines.filter((line) => line.discountAllowed).map((line) => line.rate));
    const discount = validMoney(params.discount, 'discount');
    if (discount > discountable) {
      throw new DomainError('invalid_discount', `Only ${discountable.toFixed(2)} of the bill may be discounted`);
    }
    const discountReason = text(params.discountReason, 200, 'discount reason');
    if (discount > 0 && !discountReason) throw new DomainError('invalid_discount', 'Give the reason for the discount');
    const limit = taka(Math.floor((paisa(discountable) * params.discountLimitPercent) / 100));
    if (discount > limit && !params.mayDiscountMore) {
      throw new ForbiddenError(
        'discount_limit',
        `A discount above ${params.discountLimitPercent} % (${limit.toFixed(2)}) needs diag:discount`,
      );
    }
    const shares = shareOut(
      paisa(discount),
      params.lines.map((line) => (line.discountAllowed ? paisa(line.rate) : 0)),
    );
    const net = taka(paisa(gross) - paisa(discount));
    const paid = params.payment ? validMoney(params.payment.amount, 'payment') : 0;
    if (paid > net)
      throw new DomainError('overpayment', `The bill is ${net.toFixed(2)}; ${paid.toFixed(2)} is too much`);
    if (params.payer.kind === 'corporate' && params.payer.cash && paid !== net) {
      throw new DomainError('payment_needed', "A cash client's bill is paid in full at the counter");
    }
    const lines: DiagnosticLine[] = params.lines.map((line, index) => {
      const referralPercent = params.referredById ? line.referralPercent : 0;
      return {
        testId: line.testId,
        packageId: line.packageId,
        rate: line.rate,
        discountAllowed: line.discountAllowed,
        discount: taka(shares[index]!),
        referralPercent,
        referralAmount: taka(Math.round((paisa(line.rate) * referralPercent) / 100)),
        reportDueAt: line.reportHours === null ? null : new Date(params.now.getTime() + line.reportHours * 3_600_000),
        status: 'billed',
        cancelledOn: null,
        cancelReason: null,
      };
    });
    return new DiagnosticBill({
      id: params.id,
      number: params.number,
      patientId: params.patientId,
      billedOn: params.billedOn,
      billedAt: params.now,
      referredById: params.referredById,
      corporateClientId: params.payer.kind === 'corporate' ? params.payer.clientId : null,
      staffId: params.payer.kind === 'staff' ? params.payer.staffId : null,
      admissionId,
      gross,
      discount,
      discountReason,
      net,
      cancelled: 0,
      paid,
      collected: 0,
      refunded: 0,
      status: 'billed',
      voucherNumber: null,
      billedBy: params.by,
      lines,
      version: 1,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  static restore(props: DiagnosticBillProps): DiagnosticBill {
    return new DiagnosticBill({ ...props, lines: [...props.lines] });
  }

  get id(): string {
    return this.props.id;
  }
  get number(): string {
    return this.props.number;
  }
  get lines(): readonly DiagnosticLine[] {
    return this.props.lines;
  }
  get admissionId(): string | null {
    return this.props.admissionId;
  }
  /** What the tests still billed are worth. */
  get live(): number {
    return taka(paisa(this.props.net) - paisa(this.props.cancelled));
  }
  get payer(): BillPayer {
    if (this.props.corporateClientId) return { kind: 'corporate', clientId: this.props.corporateClientId, cash: false };
    if (this.props.staffId) return { kind: 'staff', staffId: this.props.staffId };
    return { kind: 'patient' };
  }
  /** Money put in and kept. */
  get received(): number {
    return taka(paisa(this.props.paid) + paisa(this.props.collected) - paisa(this.props.refunded));
  }
  get due(): number {
    return taka(paisa(this.props.net) - paisa(this.props.cancelled) - paisa(this.received));
  }
  /** The referring doctor's commission on the tests billed (cancelled ones included). */
  get commission(): number {
    return sum(this.props.lines.map((line) => line.referralAmount));
  }

  /** Old Diagnostic Due Collection (DueCollection ledger rows by channel). */
  collect(amount: number, on: string, now: Date): number {
    this.assertBilled('collected on');
    if (this.props.admissionId) {
      throw new DomainError('indoor_bill', "An admitted patient's tests are paid with the final bill");
    }
    validMoney(amount, 'amount');
    if (amount === 0) throw new DomainError('invalid_amount', 'Collect more than nothing');
    if (amount > this.due) throw new DomainError('overpayment', `Only ${this.due.toFixed(2)} is due`);
    if (on < this.props.billedOn) throw new DomainError('invalid_date', 'A due is not collected before the bill');
    this.props.collected = taka(paisa(this.props.collected) + paisa(amount));
    this.touch(now);
    return amount;
  }

  /**
   * Old investigation cancel (per test, approved first; Cancel, DiscountAdjustment and Refund ledger rows): the tests
   * named by their line (1-based), or all still billed, cancelled with a reason; on the bill's day by the counter,
   * later only by a manager. What they were worth comes off the due first; money beyond what is left is given back.
   */
  cancelTests(params: {
    lines: readonly number[] | null;
    reason: string;
    on: string;
    mayCancelLater: boolean;
    now: Date;
  }): {
    positions: number[];
    gross: number;
    discount: number;
    commission: number;
    dueCleared: number;
    refund: number;
  } {
    this.assertBilled('cancelled');
    const reason = text(params.reason, 300, 'reason');
    if (!reason) throw new DomainError('invalid_remarks', 'Give a reason');
    if (params.on < this.props.billedOn) {
      throw new DomainError('invalid_date', 'A test is not cancelled before it was billed');
    }
    if (params.on !== this.props.billedOn && !params.mayCancelLater) {
      throw new ForbiddenError('cancel_later', "Only a manager cancels tests after the bill's day");
    }
    const live = this.props.lines.flatMap((line, index) => (line.status === 'billed' ? [index + 1] : []));
    const positions = params.lines === null ? live : [...new Set(params.lines)];
    if (positions.length === 0) throw new DomainError('invalid_lines', 'Name the tests to cancel');
    for (const position of positions) {
      if (!live.includes(position)) throw new DomainError('invalid_line', `Line ${position} is not a billed test`);
    }
    const chosen = positions.map((position) => this.props.lines[position - 1]!);
    const gross = sum(chosen.map((line) => line.rate));
    const discount = sum(chosen.map((line) => line.discount));
    const worth = taka(paisa(gross) - paisa(discount));
    const dueBefore = this.due;
    this.props.cancelled = taka(paisa(this.props.cancelled) + paisa(worth));
    const left = taka(paisa(this.props.net) - paisa(this.props.cancelled));
    const refund = taka(Math.max(0, paisa(this.received) - paisa(left)));
    this.props.refunded = taka(paisa(this.props.refunded) + paisa(refund));
    this.props.lines = this.props.lines.map((line, index) =>
      positions.includes(index + 1)
        ? { ...line, status: 'cancelled', cancelledOn: params.on, cancelReason: reason }
        : line,
    );
    if (this.props.lines.every((line) => line.status === 'cancelled')) this.props.status = 'cancelled';
    this.touch(params.now);
    return {
      positions,
      gross,
      discount,
      commission: sum(chosen.map((line) => line.referralAmount)),
      dueCleared: taka(paisa(dueBefore) - paisa(this.due)),
      refund,
    };
  }

  posted(voucherNumber: string | null): void {
    this.props.voucherNumber = voucherNumber;
  }

  assertVersion(version: number): void {
    if (version !== this.props.version) {
      throw new ConflictError('stale_bill', 'The bill was changed by someone else; reload it');
    }
  }

  toSnapshot(): Readonly<DiagnosticBillProps> {
    return { ...this.props, lines: [...this.props.lines] };
  }

  private assertBilled(action: string): void {
    if (this.props.status !== 'billed') throw new DomainError('bill_state', `A cancelled bill cannot be ${action}`);
  }

  private touch(now: Date): void {
    this.props.version += 1;
    this.props.updatedAt = now;
  }
}
