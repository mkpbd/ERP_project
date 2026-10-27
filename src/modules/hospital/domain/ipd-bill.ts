import { ConflictError, DomainError, ForbiddenError } from '../../../shared/domain/errors.js';
import { validMoney, type BillPayer, type PaymentMethod } from './opd-bill.js';
import { text } from './patient.js';

const paisa = (value: number) => Math.round(value * 100);
const taka = (paisas: number) => paisas / 100;
const percentOf = (amount: number, percent: number) => taka(Math.round((paisa(amount) * percent) / 100));
const sum = (amounts: readonly number[]) => taka(amounts.reduce((total, amount) => total + paisa(amount), 0));

export function addDays(isoDay: string, days: number): string {
  const date = new Date(`${isoDay}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** A bed stay in the organisation's days: the day it began and the day it ended (null: still in the bed). */
export interface StayDays {
  readonly bedId: string;
  readonly bedCode: string;
  readonly fromOn: string;
  readonly toOn: string | null;
  readonly rate: number;
  /** ICU, HDU, CCU, NICU …. */
  readonly intensive: boolean;
}

/** Consecutive nights in one bed at one rate. */
export interface NightRun {
  readonly bedId: string;
  readonly bedCode: string;
  readonly fromOn: string;
  /** The day after the last night. */
  readonly toOn: string;
  readonly nights: number;
  readonly rate: number;
}

/**
 * Old spGetCabinOccupancyListByPatientId with GetStayingDataForSpecificDate, without the grace hours: every day from
 * admission up to the day billed is one night (that day is not; a same-day stay has none). A day with several beds is
 * charged at the dearest, except a day moved out of an intensive bed, which is charged at the bed moved to.
 */
export function bedNights(stays: readonly StayDays[], untilOn: string): NightRun[] {
  if (stays.length === 0) return [];
  const ordered = [...stays].sort((a, b) => (a.fromOn < b.fromOn ? -1 : a.fromOn > b.fromOn ? 1 : 0));
  const runs: NightRun[] = [];
  for (let on = ordered[0]!.fromOn; on < untilOn; on = addDays(on, 1)) {
    const that = ordered.filter((stay) => stay.fromOn <= on && (stay.toOn ?? untilOn) >= on);
    if (that.length === 0) continue;
    const leftIntensive = that.some((stay) => stay.intensive && stay.toOn === on && stay !== that.at(-1));
    const bed = leftIntensive ? that.at(-1)! : that.reduce((best, stay) => (stay.rate >= best.rate ? stay : best));
    const last = runs.at(-1);
    if (last && last.bedId === bed.bedId && last.rate === bed.rate && last.toOn === on) {
      runs[runs.length - 1] = { ...last, toOn: addDays(on, 1), nights: last.nights + 1 };
    } else {
      runs.push({
        bedId: bed.bedId,
        bedCode: bed.bedCode,
        fromOn: on,
        toOn: addDays(on, 1),
        nights: 1,
        rate: bed.rate,
      });
    }
  }
  return runs;
}

/** Something given to an admitted patient (old IPDServiceRecords / IPDConsultantServices). */
export interface IpdCharge {
  readonly id: string;
  readonly serviceId: string;
  readonly serviceName: string;
  readonly doctorId: string | null;
  readonly chargedOn: string;
  readonly qty: number;
  readonly rate: number;
  readonly amount: number;
  readonly sharePercent: number;
}

/** A charge as entered: a whole quantity of 1 to 1000; a doctor when it carries a share. */
export function chargeOf(params: Omit<IpdCharge, 'amount'>): IpdCharge {
  if (!Number.isInteger(params.qty) || params.qty < 1 || params.qty > 1000) {
    throw new DomainError('invalid_quantity', 'The quantity is a whole number from 1 to 1000');
  }
  validMoney(params.rate, 'rate');
  if (params.sharePercent > 0 && params.doctorId === null) {
    throw new DomainError('doctor_needed', `${params.serviceName} carries a doctor's share; give who gave it`);
  }
  return { ...params, amount: taka(Math.round(paisa(params.rate) * params.qty)) };
}

export type IpdBillHead = 'admission' | 'bed' | 'round' | 'service';

export interface IpdBillLine {
  readonly head: IpdBillHead;
  readonly description: string;
  readonly bedId: string | null;
  readonly chargeId: string | null;
  readonly serviceId: string | null;
  readonly doctorId: string | null;
  readonly fromOn: string | null;
  readonly toOn: string | null;
  readonly qty: number;
  readonly rate: number;
  readonly amount: number;
  readonly serviceCharge: number;
  readonly shareAmount: number;
}

export type IpdBillStatus = 'billed' | 'cancelled';

export interface IpdBillProps {
  id: string;
  number: string;
  admissionId: string;
  patientId: string;
  billedOn: string;
  corporateClientId: string | null;
  staffId: string | null;
  nights: number;
  lines: IpdBillLine[];
  gross: number;
  serviceCharge: number;
  discount: number;
  discountReason: string | null;
  net: number;
  deposit: number;
  paid: number;
  collected: number;
  status: IpdBillStatus;
  cancelReason: string | null;
  cancelledOn: string | null;
  cancelledBy: string | null;
  voucherNumber: string | null;
  cancelVoucherNumber: string | null;
  billedBy: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** What the bill is made of, before the discount: the bed nights, the admission fee and the charges. */
export function billLines(params: {
  nights: readonly NightRun[];
  admissionFee: number;
  roundFeePerNight: number;
  serviceChargePercent: number;
  charges: readonly IpdCharge[];
}): IpdBillLine[] {
  const none = { bedId: null, chargeId: null, serviceId: null, doctorId: null, fromOn: null, toOn: null };
  const charged = (amount: number) => ({ amount, serviceCharge: percentOf(amount, params.serviceChargePercent) });
  const nights = params.nights.reduce((total, run) => total + run.nights, 0);
  const lines: IpdBillLine[] = [];
  if (params.admissionFee > 0) {
    lines.push({
      ...none,
      head: 'admission',
      description: 'Admission fee',
      qty: 1,
      rate: params.admissionFee,
      ...charged(params.admissionFee),
      shareAmount: 0,
    });
  }
  for (const run of params.nights) {
    lines.push({
      ...none,
      head: 'bed',
      description: `Bed ${run.bedCode}`,
      bedId: run.bedId,
      fromOn: run.fromOn,
      toOn: run.toOn,
      qty: run.nights,
      rate: run.rate,
      ...charged(taka(paisa(run.rate) * run.nights)),
      shareAmount: 0,
    });
  }
  if (params.roundFeePerNight > 0 && nights > 0) {
    lines.push({
      ...none,
      head: 'round',
      description: 'Round fee',
      qty: nights,
      rate: params.roundFeePerNight,
      ...charged(taka(paisa(params.roundFeePerNight) * nights)),
      shareAmount: 0,
    });
  }
  for (const charge of params.charges) {
    lines.push({
      ...none,
      head: 'service',
      description: charge.serviceName,
      chargeId: charge.id,
      serviceId: charge.serviceId,
      doctorId: charge.doctorId,
      fromOn: charge.chargedOn,
      qty: charge.qty,
      rate: charge.rate,
      amount: charge.amount,
      serviceCharge: 0,
      shareAmount: percentOf(charge.amount, charge.sharePercent),
    });
  }
  return lines;
}

/**
 * Old GenerateFinalBillingDashboardPage SaveAsync (FinalBills, FinalBillSummarys and FinalBillLedgers, recomputed from
 * the source tables each time, with no discount limit and the settlement never posted): the bill made at discharge,
 * kept with its lines. The advance held is taken against it; more advance than the bill is refunded first, as before.
 * The discount is limited at the counter; above the limit ipd:discount is needed.
 */
export class IpdBill {
  private constructor(private readonly props: IpdBillProps) {}

  static create(params: {
    id: string;
    number: string;
    admissionId: string;
    patientId: string;
    billedOn: string;
    payer: BillPayer;
    nights: number;
    lines: readonly IpdBillLine[];
    discount: number;
    discountReason: string | null;
    discountLimitPercent: number;
    mayDiscountMore: boolean;
    /** The advance held on the admission. */
    deposit: number;
    payment: { method: PaymentMethod; amount: number } | null;
    by: string;
    now: Date;
  }): IpdBill {
    const gross = sum(params.lines.map((line) => line.amount));
    const serviceCharge = sum(params.lines.map((line) => line.serviceCharge));
    const total = taka(paisa(gross) + paisa(serviceCharge));
    const discount = validMoney(params.discount, 'discount');
    if (discount > total) throw new DomainError('invalid_discount', 'The discount is more than the bill');
    const discountReason = text(params.discountReason, 200, 'discount reason');
    if (discount > 0 && !discountReason) throw new DomainError('invalid_discount', 'Give the reason for the discount');
    const limit = taka(Math.floor((paisa(total) * params.discountLimitPercent) / 100));
    if (discount > limit && !params.mayDiscountMore) {
      throw new ForbiddenError(
        'discount_limit',
        `A discount above ${params.discountLimitPercent} % (${limit.toFixed(2)}) needs ipd:discount`,
      );
    }
    const net = taka(paisa(total) - paisa(discount));
    if (params.deposit > net) {
      throw new DomainError(
        'over_advance',
        `The advance held (${params.deposit.toFixed(2)}) is more than the bill (${net.toFixed(2)}); refund ${taka(paisa(params.deposit) - paisa(net)).toFixed(2)} first`,
      );
    }
    const paid = params.payment ? validMoney(params.payment.amount, 'payment') : 0;
    const left = taka(paisa(net) - paisa(params.deposit));
    if (paid > left)
      throw new DomainError('overpayment', `${left.toFixed(2)} is left to pay; ${paid.toFixed(2)} is too much`);
    if (params.payer.kind === 'corporate' && params.payer.cash && paid !== left) {
      throw new DomainError('payment_needed', "A cash client's bill is paid in full");
    }
    return new IpdBill({
      id: params.id,
      number: params.number,
      admissionId: params.admissionId,
      patientId: params.patientId,
      billedOn: params.billedOn,
      corporateClientId: params.payer.kind === 'corporate' ? params.payer.clientId : null,
      staffId: params.payer.kind === 'staff' ? params.payer.staffId : null,
      nights: params.nights,
      lines: [...params.lines],
      gross,
      serviceCharge,
      discount,
      discountReason,
      net,
      deposit: params.deposit,
      paid,
      collected: 0,
      status: 'billed',
      cancelReason: null,
      cancelledOn: null,
      cancelledBy: null,
      voucherNumber: null,
      cancelVoucherNumber: null,
      billedBy: params.by,
      version: 1,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  static restore(props: IpdBillProps): IpdBill {
    return new IpdBill({ ...props, lines: [...props.lines] });
  }

  get id(): string {
    return this.props.id;
  }
  get number(): string {
    return this.props.number;
  }
  get admissionId(): string {
    return this.props.admissionId;
  }
  get billedOn(): string {
    return this.props.billedOn;
  }
  get status(): IpdBillStatus {
    return this.props.status;
  }
  get lines(): readonly IpdBillLine[] {
    return this.props.lines;
  }
  get payer(): BillPayer {
    if (this.props.corporateClientId) return { kind: 'corporate', clientId: this.props.corporateClientId, cash: false };
    if (this.props.staffId) return { kind: 'staff', staffId: this.props.staffId };
    return { kind: 'patient' };
  }
  get due(): number {
    return taka(
      paisa(this.props.net) - paisa(this.props.deposit) - paisa(this.props.paid) - paisa(this.props.collected),
    );
  }
  /** What the patient's side has put in against the bill: the advance taken, the payment and the collections. */
  get settled(): number {
    return taka(paisa(this.props.deposit) + paisa(this.props.paid) + paisa(this.props.collected));
  }
  get share(): number {
    return sum(this.props.lines.map((line) => line.shareAmount));
  }
  /** The income of each head, and the service charge. */
  get income(): Record<IpdBillHead | 'serviceCharge', number> {
    const of = (head: IpdBillHead) =>
      sum(this.props.lines.filter((line) => line.head === head).map((line) => line.amount));
    return {
      admission: of('admission'),
      bed: of('bed'),
      round: of('round'),
      service: of('service'),
      serviceCharge: this.props.serviceCharge,
    };
  }

  /** Old IPD due collection for discharged patients (FinalBillLedgers DueCollection rows). */
  collect(amount: number, on: string, now: Date): number {
    this.assertBilled('collected on');
    validMoney(amount, 'amount');
    if (amount === 0) throw new DomainError('invalid_amount', 'Collect more than nothing');
    if (amount > this.due) throw new DomainError('overpayment', `Only ${this.due.toFixed(2)} is due`);
    if (on < this.props.billedOn) throw new DomainError('invalid_date', 'A due is not collected before the bill');
    this.props.collected = taka(paisa(this.props.collected) + paisa(amount));
    this.touch(now);
    return amount;
  }

  /**
   * A bill made too early or wrong (the old system edited discharged bills in place): cancelled with a reason, on its
   * own day by the counter and later only by a manager, while the patient is still in. What was put in against it is
   * held as advance again.
   */
  cancel(params: { reason: string; on: string; by: string; mayCancelLater: boolean; now: Date }): {
    held: number;
    dueCleared: number;
  } {
    this.assertBilled('cancelled');
    const reason = text(params.reason, 300, 'reason');
    if (!reason) throw new DomainError('invalid_remarks', 'Give a reason');
    if (params.on !== this.props.billedOn && !params.mayCancelLater) {
      throw new ForbiddenError('cancel_later', 'Only a manager cancels a bill after its day');
    }
    const result = { held: this.settled, dueCleared: this.due };
    this.props.status = 'cancelled';
    this.props.cancelReason = reason;
    this.props.cancelledOn = params.on;
    this.props.cancelledBy = params.by;
    this.touch(params.now);
    return result;
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

  toSnapshot(): Readonly<IpdBillProps> {
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
