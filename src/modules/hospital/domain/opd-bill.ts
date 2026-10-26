import { ConflictError, DomainError, ForbiddenError } from '../../../shared/domain/errors.js';
import type { VisitType } from './appointment.js';
import { text } from './patient.js';

export const PAYMENT_METHODS = ['cash', 'card', 'mobile'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const MAX_BILL_LINES = 10;
const MAX_AMOUNT = 10_000_000;

const paisa = (value: number) => Math.round(value * 100);
const taka = (paisas: number) => paisas / 100;

/** An amount of money: 0 or more, at most two decimals. */
export function validMoney(amount: number, what: string): number {
  if (!Number.isFinite(amount) || amount < 0 || amount > MAX_AMOUNT || Math.abs(paisa(amount) - amount * 100) > 1e-6) {
    throw new DomainError('invalid_amount', `The ${what} is 0 to ${MAX_AMOUNT} with at most 2 decimals`);
  }
  return amount;
}

/** Visits to the same doctor within the policy's days are follow-ups; others are new (first and report are chosen). */
export function suggestedVisit(lastVisitOn: string | null, today: string, followUpDays: number): VisitType {
  if (lastVisitOn === null) return 'new';
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${lastVisitOn}T00:00:00Z`)) / 86_400_000);
  return days <= followUpDays ? 'follow_up' : 'new';
}

export interface BillLine {
  readonly doctorId: string;
  readonly visitType: VisitType;
  readonly fee: number;
  readonly sharePercent: number;
  /** The doctor's share of the fee (old: 40 % of the line, hard-coded). */
  readonly shareAmount: number;
}

export interface BillPayment {
  readonly kind: 'payment' | 'collection' | 'refund';
  readonly number: string | null;
  readonly method: PaymentMethod;
  readonly reference: string | null;
  readonly amount: number;
  readonly paidOn: string;
}

export type BillStatus = 'billed' | 'cancelled';

export interface OpdBillProps {
  id: string;
  number: string;
  patientId: string;
  appointmentId: string | null;
  billedOn: string;
  referredById: string | null;
  lines: BillLine[];
  gross: number;
  discount: number;
  discountReason: string | null;
  net: number;
  paid: number;
  collected: number;
  status: BillStatus;
  cancelReason: string | null;
  cancelledOn: string | null;
  cancelledBy: string | null;
  refunded: number;
  voucherNumber: string | null;
  cancelVoucherNumber: string | null;
  billedBy: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Old Consultation Fee page (PatientRecordConsultancyFees, ConsultancyDetails, OPDConsultancyLedger and the 40 %
 * ConsultantGlobalLedger rows, each saved on its own): one bill, saved and posted at once. The discount is limited
 * at the counter; above the limit opd:discount is needed. The doctor's share is the doctor's percentage (or the
 * policy's) of each fee.
 */
export class OpdBill {
  private constructor(
    private readonly props: OpdBillProps,
    private readonly payments: BillPayment[],
  ) {}

  static create(params: {
    id: string;
    number: string;
    patientId: string;
    appointmentId: string | null;
    billedOn: string;
    referredById: string | null;
    lines: readonly Omit<BillLine, 'shareAmount'>[];
    discount: number;
    discountReason: string | null;
    /** The share of the bill a counter may discount, and whether this user may give more. */
    discountLimitPercent: number;
    mayDiscountMore: boolean;
    payment: { method: PaymentMethod; reference: string | null; amount: number } | null;
    by: string;
    now: Date;
  }): OpdBill {
    if (params.lines.length === 0 || params.lines.length > MAX_BILL_LINES) {
      throw new DomainError('invalid_lines', `A bill has 1 to ${MAX_BILL_LINES} consultations`);
    }
    const lines = params.lines.map((line, index) => {
      validMoney(line.fee, `fee of line ${index + 1}`);
      if (!(line.sharePercent >= 0 && line.sharePercent <= 100)) {
        throw new DomainError('invalid_share', `Line ${index + 1}: a share is 0 to 100 %`);
      }
      return { ...line, shareAmount: taka(Math.round((paisa(line.fee) * line.sharePercent) / 100)) };
    });
    const gross = taka(lines.reduce((total, line) => total + paisa(line.fee), 0));
    const discount = validMoney(params.discount, 'discount');
    if (discount > gross) throw new DomainError('invalid_discount', 'The discount is more than the bill');
    const discountReason = text(params.discountReason, 200, 'discount reason');
    if (discount > 0 && !discountReason) throw new DomainError('invalid_discount', 'Give the reason for the discount');
    const limit = taka(Math.floor((paisa(gross) * params.discountLimitPercent) / 100));
    if (discount > limit && !params.mayDiscountMore) {
      throw new ForbiddenError(
        'discount_limit',
        `A discount above ${params.discountLimitPercent} % (${limit.toFixed(2)}) needs opd:discount`,
      );
    }
    const net = taka(paisa(gross) - paisa(discount));
    const paid = params.payment ? validMoney(params.payment.amount, 'payment') : 0;
    if (paid > net)
      throw new DomainError('overpayment', `The bill is ${net.toFixed(2)}; ${paid.toFixed(2)} is too much`);
    const payments: BillPayment[] =
      params.payment && paid > 0
        ? [
            {
              kind: 'payment',
              number: null,
              method: params.payment.method,
              reference: text(params.payment.reference, 100, 'payment reference'),
              amount: paid,
              paidOn: params.billedOn,
            },
          ]
        : [];
    return new OpdBill(
      {
        id: params.id,
        number: params.number,
        patientId: params.patientId,
        appointmentId: params.appointmentId,
        billedOn: params.billedOn,
        referredById: params.referredById,
        lines,
        gross,
        discount,
        discountReason,
        net,
        paid,
        collected: 0,
        status: 'billed',
        cancelReason: null,
        cancelledOn: null,
        cancelledBy: null,
        refunded: 0,
        voucherNumber: null,
        cancelVoucherNumber: null,
        billedBy: params.by,
        version: 1,
        createdAt: params.now,
        updatedAt: params.now,
      },
      payments,
    );
  }

  static restore(props: OpdBillProps, payments: BillPayment[]): OpdBill {
    const bill = new OpdBill({ ...props, lines: [...props.lines] }, [...payments]);
    bill.paymentsSaved();
    return bill;
  }

  get id(): string {
    return this.props.id;
  }
  get number(): string {
    return this.props.number;
  }
  get patientId(): string {
    return this.props.patientId;
  }
  get billedOn(): string {
    return this.props.billedOn;
  }
  get lines(): readonly BillLine[] {
    return this.props.lines;
  }
  get share(): number {
    return taka(this.props.lines.reduce((total, line) => total + paisa(line.shareAmount), 0));
  }
  get due(): number {
    return taka(paisa(this.props.net) - paisa(this.props.paid) - paisa(this.props.collected));
  }
  /** Payments not saved yet. */
  get newPayments(): readonly BillPayment[] {
    return this.payments.filter((payment) => !this.saved.has(payment));
  }

  private readonly saved = new Set<BillPayment>();

  /** Marks the payments as saved (by the repository). */
  paymentsSaved(): void {
    for (const payment of this.payments) this.saved.add(payment);
  }

  /** Old OPD bill collection (posted as Payment there, DueCollection on the emergency page). */
  collect(params: {
    number: string;
    method: PaymentMethod;
    reference: string | null;
    amount: number;
    on: string;
    now: Date;
  }) {
    this.assertBilled('collected on');
    const amount = validMoney(params.amount, 'amount');
    if (amount === 0) throw new DomainError('invalid_amount', 'Collect more than nothing');
    if (amount > this.due) {
      throw new DomainError('overpayment', `Only ${this.due.toFixed(2)} is due`);
    }
    if (params.on < this.props.billedOn)
      throw new DomainError('invalid_date', 'A due is not collected before the bill');
    const payment: BillPayment = {
      kind: 'collection',
      number: params.number,
      method: params.method,
      reference: text(params.reference, 100, 'payment reference'),
      amount,
      paidOn: params.on,
    };
    this.payments.push(payment);
    this.props.collected = taka(paisa(this.props.collected) + paisa(amount));
    this.touch(params.now);
    return payment;
  }

  /**
   * Old ConsultancyCancelService (straight to cancelled, approval page bypassed, doctor's share left in place): the
   * whole bill is cancelled with a reason, on its own day by the counter and later only by a manager. What was paid
   * goes back by the method it came in; the doctor's share is taken back.
   */
  cancel(params: { reason: string; on: string; by: string; mayCancelLater: boolean; now: Date }): {
    refunds: Map<PaymentMethod, number>;
    dueCleared: number;
  } {
    this.assertBilled('cancelled');
    const reason = text(params.reason, 300, 'reason');
    if (!reason) throw new DomainError('invalid_remarks', 'Give a reason');
    if (params.on < this.props.billedOn)
      throw new DomainError('invalid_date', 'A bill is not cancelled before it was made');
    if (params.on !== this.props.billedOn && !params.mayCancelLater) {
      throw new ForbiddenError('cancel_later', 'Only a manager cancels a bill after its day');
    }
    const refunds = new Map<PaymentMethod, number>();
    for (const payment of this.payments) {
      if (payment.kind === 'refund') continue;
      refunds.set(payment.method, taka(paisa(refunds.get(payment.method) ?? 0) + paisa(payment.amount)));
    }
    const dueCleared = this.due;
    for (const [method, amount] of refunds) {
      this.payments.push({ kind: 'refund', number: null, method, reference: null, amount, paidOn: params.on });
    }
    this.props.refunded = taka([...refunds.values()].reduce((total, amount) => total + paisa(amount), 0));
    this.props.status = 'cancelled';
    this.props.cancelReason = reason;
    this.props.cancelledOn = params.on;
    this.props.cancelledBy = params.by;
    this.touch(params.now);
    return { refunds, dueCleared };
  }

  posted(voucherNumber: string | null): void {
    this.props.voucherNumber = voucherNumber;
  }

  cancelPosted(voucherNumber: string | null): void {
    this.props.cancelVoucherNumber = voucherNumber;
  }

  assertVersion(version: number): void {
    if (version !== this.props.version) {
      throw new ConflictError('stale_bill', 'The bill was changed by someone else; reload it');
    }
  }

  toSnapshot(): Readonly<OpdBillProps> {
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
