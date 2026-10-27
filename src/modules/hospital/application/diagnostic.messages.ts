import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page, PageRequest } from '../../../shared/application/pagination.js';
import type { DiagnosticStatus } from '../domain/diagnostic-bill.js';
import type { PaymentMethod } from '../domain/opd-bill.js';
import type { DiagnosticPolicy } from '../domain/repositories.js';

export const DIAGNOSTIC_INCOME_ROLE = 'diagnostic_income';
export const DIAGNOSTIC_DISCOUNT_ROLE = 'diagnostic_discount';
/** The referring doctors' commission on tests (credited to consultant_payable). */
export const REFERRAL_COMMISSION_ROLE = 'referral_commission_expense';

export interface DiagnosticBillFilter extends PageRequest {
  readonly patientId?: string | undefined;
  readonly referredById?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly status?: DiagnosticStatus | undefined;
  readonly withDue?: boolean | undefined;
  readonly corporateClientId?: string | undefined;
  readonly admissionId?: string | undefined;
}

export interface DiagnosticBillSummary {
  readonly id: string;
  readonly number: string;
  readonly billedOn: string;
  readonly patientId: string;
  readonly uhid: number;
  readonly patientName: string;
  readonly referredByName: string | null;
  readonly gross: number;
  readonly discount: number;
  readonly net: number;
  readonly cancelled: number;
  readonly paid: number;
  readonly collected: number;
  readonly refunded: number;
  readonly due: number;
  readonly status: DiagnosticStatus;
  readonly corporateClientId: string | null;
  readonly corporateClientName: string | null;
  readonly staffId: string | null;
  readonly admissionId: string | null;
  readonly version: number;
}

export interface DiagnosticBillView extends DiagnosticBillSummary {
  readonly billedAt: Date;
  readonly sex: string;
  readonly dateOfBirth: string;
  readonly mobileNo: string | null;
  readonly referredById: string | null;
  readonly discountReason: string | null;
  readonly voucherNumber: string | null;
  readonly billedBy: string | null;
  readonly lines: {
    readonly line: number;
    readonly testId: string;
    readonly testName: string;
    readonly departmentName: string;
    readonly roomNo: string | null;
    readonly specimen: string | null;
    readonly packageName: string | null;
    readonly rate: number;
    readonly discount: number;
    readonly referralAmount: number;
    readonly reportDueAt: Date | null;
    readonly status: DiagnosticStatus;
    readonly cancelledOn: string | null;
    readonly cancelReason: string | null;
  }[];
  readonly payments: {
    readonly kind: 'payment' | 'collection' | 'refund';
    readonly number: string | null;
    readonly method: PaymentMethod;
    readonly reference: string | null;
    readonly amount: number;
    readonly paidOn: string;
  }[];
}

export interface PackageTestsView {
  readonly packageId: string;
  readonly name: string;
  readonly isActive: boolean;
  readonly tests: {
    readonly testId: string;
    readonly testName: string;
    readonly listRate: number;
    readonly rate: number;
  }[];
  readonly total: number;
}

export abstract class DiagnosticBillReadRepository {
  abstract list(filter: DiagnosticBillFilter): Promise<Page<DiagnosticBillSummary>>;
  abstract get(id: string): Promise<DiagnosticBillView | null>;
  abstract packageTests(packageId: string): Promise<PackageTestsView | null>;
}

export class SetDiagnosticPolicyCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly policy: DiagnosticPolicy,
  ) {
    super();
  }
}

export class GetDiagnosticPolicyQuery extends Query<DiagnosticPolicy> {
  constructor(readonly actor: Actor) {
    super();
  }
}

/** The whole list of a package's tests, each at its rate inside the package. */
export class SetPackageTestsCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly packageId: string,
    readonly tests: readonly { readonly testId: string; readonly rate: number }[],
  ) {
    super();
  }
}

export class GetPackageTestsQuery extends Query<PackageTestsView> {
  constructor(
    readonly actor: Actor,
    readonly packageId: string,
  ) {
    super();
  }
}

export interface DiagnosticBillInput {
  readonly patientId: string;
  /** An admitted patient's tests, charged to the stay (no payer, discount or payment). */
  readonly admissionId: string | null;
  readonly referredById: string | null;
  /** Left out: the patient's own corporate client, if any. */
  readonly corporateClientId?: string | null | undefined;
  readonly staffId: string | null;
  readonly testIds: readonly string[];
  readonly packageIds: readonly string[];
  /** Null: the corporate client's own discount, if any. */
  readonly discount: number | null;
  readonly discountReason: string | null;
  readonly payment: {
    readonly method: PaymentMethod;
    readonly reference: string | null;
    readonly amount: number;
  } | null;
}

export class CreateDiagnosticBillCommand extends Command<{ id: string; number: string; net: number; due: number }> {
  constructor(
    readonly actor: Actor,
    readonly input: DiagnosticBillInput,
  ) {
    super();
  }
}

export class CollectDiagnosticDueCommand extends Command<{ number: string; due: number }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly money: { readonly amount: number; readonly method: PaymentMethod; readonly reference: string | null },
  ) {
    super();
  }
}

export class CancelDiagnosticTestsCommand extends Command<{ refunded: number; due: number }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    /** Lines (1-based) to cancel; null: every test still billed. */
    readonly lines: readonly number[] | null,
    readonly reason: string,
    readonly refundMethod: PaymentMethod,
  ) {
    super();
  }
}

export class ListDiagnosticBillsQuery extends Query<Page<DiagnosticBillSummary>> {
  constructor(
    readonly actor: Actor,
    readonly filter: DiagnosticBillFilter,
  ) {
    super();
  }
}

export class GetDiagnosticBillQuery extends Query<DiagnosticBillView> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}
