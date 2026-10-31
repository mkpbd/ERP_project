import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page, PageRequest } from '../../../shared/application/pagination.js';
import type { AdmissionStatus } from '../domain/admission.js';
import type { IpdBillHead, IpdBillStatus } from '../domain/ipd-bill.js';
import type { PaymentMethod } from '../domain/opd-bill.js';
import type { IpdPaymentKind, IpdPolicy } from '../domain/repositories.js';

/** Charging services to admitted patients, taking and refunding advances, final bills and their dues. */
export const IPD_BILL = 'ipd:bill';
/** A final bill discount above the counter's limit. */
export const IPD_DISCOUNT = 'ipd:discount';

export const IPD_ADVANCE_ROLE = 'ipd_advance';
export const IPD_RECEIVABLE_ROLE = 'ipd_receivable';
export const IPD_DISCOUNT_ROLE = 'ipd_discount';
export const IPD_INCOME_ROLES: Record<IpdBillHead | 'serviceCharge', string> = {
  admission: 'ipd_admission_income',
  bed: 'ipd_bed_income',
  round: 'ipd_round_income',
  service: 'ipd_service_income',
  /** Not income here: the pharmacy took it as sales when it sent the medicine; the bill clears what the stay owed. */
  medicine: 'ipd_medicine_unbilled',
  /** Not income here either: the diagnostic bill took it; the bill clears what the stay owed for the tests. */
  investigation: 'ipd_investigation_unbilled',
  /** Not income here: the blood bank took it when it issued the blood; the bill clears what the stay owed. */
  blood: 'ipd_blood_unbilled',
  serviceCharge: 'ipd_service_charge_income',
};

export interface IpdBillLineView {
  readonly head: IpdBillHead;
  readonly description: string;
  readonly doctorId: string | null;
  readonly doctorName: string | null;
  readonly fromOn: string | null;
  readonly toOn: string | null;
  readonly qty: number;
  readonly rate: number;
  readonly amount: number;
  readonly serviceCharge: number;
  readonly shareAmount: number;
}

export interface IpdPaymentView {
  readonly number: string;
  readonly kind: IpdPaymentKind;
  readonly method: PaymentMethod;
  readonly reference: string | null;
  readonly amount: number;
  readonly paidOn: string;
  readonly billNumber: string | null;
}

export interface IpdChargeView {
  readonly id: string;
  readonly serviceId: string;
  readonly serviceName: string;
  readonly doctorId: string | null;
  readonly doctorName: string | null;
  readonly chargedOn: string;
  readonly qty: number;
  readonly rate: number;
  readonly amount: number;
  readonly note: string | null;
  readonly status: 'active' | 'cancelled';
  readonly cancelReason: string | null;
}

export interface IpdBillFilter extends PageRequest {
  readonly patientId?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly status?: IpdBillStatus | undefined;
  readonly withDue?: boolean | undefined;
  readonly corporateClientId?: string | undefined;
}

export interface IpdBillSummary {
  readonly id: string;
  readonly number: string;
  readonly billedOn: string;
  readonly admissionId: string;
  readonly admissionNumber: string;
  readonly patientId: string;
  readonly uhid: number;
  readonly patientName: string;
  readonly net: number;
  readonly deposit: number;
  readonly paid: number;
  readonly collected: number;
  readonly due: number;
  readonly status: IpdBillStatus;
  readonly corporateClientId: string | null;
  readonly corporateClientName: string | null;
  readonly staffId: string | null;
  readonly version: number;
}

export interface IpdBillView extends IpdBillSummary {
  readonly nights: number;
  readonly gross: number;
  readonly serviceCharge: number;
  readonly discount: number;
  readonly discountReason: string | null;
  readonly cancelReason: string | null;
  readonly cancelledOn: string | null;
  readonly voucherNumber: string | null;
  readonly cancelVoucherNumber: string | null;
  readonly billedBy: string | null;
  readonly createdAt: Date;
  readonly lines: IpdBillLineView[];
}

/** An admission's account: the bill in force, or what it would be if made today, and the money on it. */
export interface IpdAccount {
  readonly admissionId: string;
  readonly admissionNumber: string;
  readonly admissionStatus: AdmissionStatus;
  /** The day the lines run to: the bill's day, else today (or the discharge day). */
  readonly asOf: string;
  readonly nights: number;
  readonly lines: IpdBillLineView[];
  readonly gross: number;
  readonly serviceCharge: number;
  readonly total: number;
  /** Advance held (nothing while a bill is in force: it was taken against the bill). */
  readonly held: number;
  /** Left to pay: the bill's due, else the total less the advance held. */
  readonly balance: number;
  readonly bill: {
    readonly id: string;
    readonly number: string;
    readonly billedOn: string;
    readonly discount: number;
    readonly net: number;
    readonly deposit: number;
    readonly paid: number;
    readonly collected: number;
    readonly due: number;
    readonly version: number;
  } | null;
  readonly charges: IpdChargeView[];
  readonly payments: IpdPaymentView[];
  /** Ward indents the pharmacy has not answered yet (old: deleted at discharge; here a warning). */
  readonly openIndents: number;
}

export interface IpdReceipt extends IpdPaymentView {
  readonly admissionNumber: string;
  readonly patientName: string;
  readonly uhid: number;
  readonly receivedBy: string | null;
  readonly createdAt: Date;
}

export abstract class IpdBillingReadRepository {
  abstract charges(admissionId: string): Promise<IpdChargeView[]>;
  abstract payments(admissionId: string): Promise<IpdPaymentView[]>;
  abstract doctorNames(ids: readonly string[]): Promise<Map<string, string>>;
  abstract liveBillId(admissionId: string): Promise<string | null>;
  abstract list(filter: IpdBillFilter): Promise<Page<IpdBillSummary>>;
  abstract get(id: string): Promise<IpdBillView | null>;
  abstract receipt(number: string): Promise<IpdReceipt | null>;
}

export class SetIpdPolicyCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly policy: IpdPolicy,
  ) {
    super();
  }
}

export class GetIpdPolicyQuery extends Query<IpdPolicy> {
  constructor(readonly actor: Actor) {
    super();
  }
}

export interface ChargeInput {
  readonly serviceId: string;
  readonly doctorId: string | null;
  readonly qty: number;
  /** Left out: today. */
  readonly chargedOn: string | null;
  readonly note: string | null;
  /** The operation of the stay it is charged for (step 15a); left out: none. */
  readonly otCaseId?: string | null;
}

export class AddIpdChargeCommand extends Command<{ id: string; amount: number }> {
  constructor(
    readonly actor: Actor,
    readonly admissionId: string,
    readonly input: ChargeInput,
  ) {
    super();
  }
}

export class CancelIpdChargeCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly admissionId: string,
    readonly chargeId: string,
    readonly reason: string,
  ) {
    super();
  }
}

export interface MoneyInput {
  readonly amount: number;
  readonly method: PaymentMethod;
  readonly reference: string | null;
}

/** An advance taken, or advance held given back. */
export class MoveIpdAdvanceCommand extends Command<{ number: string; held: number }> {
  constructor(
    readonly actor: Actor,
    readonly admissionId: string,
    readonly kind: 'advance' | 'refund',
    readonly money: MoneyInput,
  ) {
    super();
  }
}

export interface FinalBillInput {
  /** Null: the corporate client's own discount, if any. */
  readonly discount: number | null;
  readonly discountReason: string | null;
  readonly payment: MoneyInput | null;
}

export class MakeIpdBillCommand extends Command<{
  id: string;
  number: string;
  net: number;
  due: number;
  receipt: string | null;
}> {
  constructor(
    readonly actor: Actor,
    readonly admissionId: string,
    readonly input: FinalBillInput,
  ) {
    super();
  }
}

export class CancelIpdBillCommand extends Command<{ held: number }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly reason: string,
  ) {
    super();
  }
}

export class CollectIpdDueCommand extends Command<{ number: string; due: number }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly money: MoneyInput,
  ) {
    super();
  }
}

export class GetIpdAccountQuery extends Query<IpdAccount> {
  constructor(
    readonly actor: Actor,
    readonly admissionId: string,
  ) {
    super();
  }
}

export class ListIpdBillsQuery extends Query<Page<IpdBillSummary>> {
  constructor(
    readonly actor: Actor,
    readonly filter: IpdBillFilter,
  ) {
    super();
  }
}

export class GetIpdBillQuery extends Query<IpdBillView> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}
