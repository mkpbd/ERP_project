import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page, PageRequest } from '../../../shared/application/pagination.js';
import type { VisitType } from '../domain/appointment.js';
import type { BillPayment, BillStatus, PaymentMethod } from '../domain/opd-bill.js';
import type { OpdPolicy } from '../domain/repositories.js';

/** Billing consultations and collecting their dues; cancelling bills on their own day. */
export const OPD_BILL = 'opd:bill';
/** A discount above the counter's limit. */
export const OPD_DISCOUNT = 'opd:discount';

export const OPD_RECEIPT_ROLES: Record<PaymentMethod, string> = {
  cash: 'cash_in_hand',
  card: 'card_receipts',
  mobile: 'mobile_wallet_receipts',
};
export const OPD_INCOME_ROLE = 'opd_consultation_income';
export const OPD_SERVICE_INCOME_ROLE = 'opd_service_income';
export const OPD_DISCOUNT_ROLE = 'opd_discount';
export const OPD_RECEIVABLE_ROLE = 'opd_receivable';
/** What corporate credit clients owe for their people's bills. */
export const CORPORATE_RECEIVABLE_ROLE = 'corporate_receivable';
/** What staff owe for their bills (deducted from salary in a later step). */
export const STAFF_RECEIVABLE_ROLE = 'staff_receivable';
export const DOCTOR_FEE_ROLE = 'doctor_fee_expense';
export const CONSULTANT_PAYABLE_ROLE = 'consultant_payable';
export const OPD_JOURNAL = 'JV';

export interface OpdBillFilter extends PageRequest {
  readonly patientId?: string | undefined;
  readonly doctorId?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly status?: BillStatus | undefined;
  /** Only bills with something still due. */
  readonly withDue?: boolean | undefined;
  readonly corporateClientId?: string | undefined;
  readonly staffId?: string | undefined;
}

export interface OpdBillSummary {
  readonly id: string;
  readonly number: string;
  readonly billedOn: string;
  readonly patientId: string;
  readonly uhid: number;
  readonly patientName: string;
  readonly gross: number;
  readonly discount: number;
  readonly net: number;
  readonly paid: number;
  readonly collected: number;
  readonly due: number;
  readonly status: BillStatus;
  readonly corporateClientId: string | null;
  readonly corporateClientName: string | null;
  readonly staffId: string | null;
  readonly version: number;
}

export interface OpdBillView extends OpdBillSummary {
  readonly appointmentId: string | null;
  readonly mobileNo: string | null;
  readonly sex: string;
  readonly dateOfBirth: string;
  readonly referredById: string | null;
  readonly referredByName: string | null;
  readonly discountReason: string | null;
  readonly cancelReason: string | null;
  readonly cancelledOn: string | null;
  readonly refunded: number;
  readonly voucherNumber: string | null;
  readonly cancelVoucherNumber: string | null;
  readonly billedBy: string | null;
  readonly createdAt: Date;
  readonly lines: {
    readonly line: number;
    readonly doctorId: string | null;
    readonly doctorName: string | null;
    readonly roomNo: string | null;
    readonly visitType: VisitType | null;
    readonly serviceId: string | null;
    readonly serviceName: string | null;
    readonly qty: number;
    readonly rate: number;
    readonly fee: number;
    readonly sharePercent: number;
    readonly shareAmount: number;
  }[];
  readonly payments: (BillPayment & { readonly receivedBy: string | null })[];
}

export abstract class OpdBillReadRepository {
  abstract list(filter: OpdBillFilter): Promise<Page<OpdBillSummary>>;
  abstract get(id: string): Promise<OpdBillView | null>;
}

export interface BillInput {
  readonly patientId: string;
  readonly appointmentId: string | null;
  readonly referredById: string | null;
  /**
   * A consultation (a doctor; a visit type left out is suggested: a follow-up within the policy's days, else new) or
   * a service (with qty, and the doctor who gave it when it carries a share).
   */
  readonly lines: readonly {
    doctorId: string | null;
    visitType: VisitType | null;
    serviceId: string | null;
    qty: number;
  }[];
  /** Billed to a corporate client or a staff member instead of the patient. */
  readonly corporateClientId: string | null;
  readonly staffId: string | null;
  /** Left out: the corporate client's discount, if any. */
  readonly discount: number | null;
  readonly discountReason: string | null;
  readonly payment: { method: PaymentMethod; reference: string | null; amount: number } | null;
}

export class SetOpdPolicyCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly policy: OpdPolicy,
  ) {
    super();
  }
}

export class CreateOpdBillCommand extends Command<{ id: string; number: string; net: number; due: number }> {
  constructor(
    readonly actor: Actor,
    readonly input: BillInput,
  ) {
    super();
  }
}

export class CollectOpdDueCommand extends Command<{ number: string }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly amount: number,
    readonly method: PaymentMethod,
    readonly reference: string | null,
  ) {
    super();
  }
}

/** Old corporate collection: a company pays, oldest bills first, on one receipt. */
export class CollectCorporateDueCommand extends Command<{
  number: string;
  settled: { billId: string; number: string; amount: number }[];
}> {
  constructor(
    readonly actor: Actor,
    readonly clientId: string,
    readonly amount: number,
    readonly method: PaymentMethod,
    readonly reference: string | null,
  ) {
    super();
  }
}

export class CancelOpdBillCommand extends Command<{ refunded: number }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly reason: string,
  ) {
    super();
  }
}

export class GetOpdPolicyQuery extends Query<OpdPolicy> {
  constructor(readonly actor: Actor) {
    super();
  }
}

/** The visit type and fee a consultation would be billed at today. */
export class SuggestVisitQuery extends Query<{
  visitType: VisitType;
  lastVisitOn: string | null;
  fee: number;
}> {
  constructor(
    readonly actor: Actor,
    readonly patientId: string,
    readonly doctorId: string,
  ) {
    super();
  }
}

export class ListOpdBillsQuery extends Query<Page<OpdBillSummary>> {
  constructor(
    readonly actor: Actor,
    readonly filter: OpdBillFilter,
  ) {
    super();
  }
}

export class GetOpdBillQuery extends Query<OpdBillView> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}
