import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page, PageRequest } from '../../../shared/application/pagination.js';
import type { BloodGroup, Screen, ScreenResult, UnitStatus } from '../domain/blood.js';

/** Seeing donors, donations, the stock and requests. */
export const BB_READ = 'bb:read';
/** Component types and their rates; discarding units. */
export const BB_MANAGE = 'bb:manage';
/** Registering donors, taking donations, screening them and preparing components. */
export const BB_COLLECT = 'bb:collect';
/** Asking for blood for a patient, and cancelling the request. */
export const BB_REQUEST = 'bb:request';
/** Cross-matching units and issuing them. */
export const BB_ISSUE = 'bb:issue';

/** Kept through the shared record stores. */
export const BLOOD_RECORDS = { componentType: 'blood_component_type' } as const;

/** Charged to an admitted patient's stay until its final bill takes it (Dr here, Cr there). */
export const IPD_BLOOD_ROLE = 'ipd_blood_unbilled';
export const BLOOD_BANK_INCOME_ROLE = 'blood_bank_income';

/** The organisation's time zone, for the blood bank's days. */
export const BB_SETTINGS = Symbol('BB_SETTINGS');
export interface BloodBankSettings {
  readonly timeZone: string;
}

export interface DonorFilter extends PageRequest {
  readonly q?: string | undefined;
  readonly bloodGroup?: BloodGroup | undefined;
}

export interface DonorSummary {
  readonly id: string;
  readonly number: string;
  readonly fullName: string;
  readonly sex: string;
  readonly dateOfBirth: string;
  readonly bloodGroup: BloodGroup;
  readonly mobileNo: string | null;
  readonly lastDonatedOn: string | null;
  readonly deferredUntil: string | null;
  readonly isActive: boolean;
}

export interface UnitFilter extends PageRequest {
  readonly status?: UnitStatus | undefined;
  readonly bloodGroup?: BloodGroup | undefined;
  readonly componentTypeId?: string | undefined;
  readonly donationId?: string | undefined;
}

export interface UnitSummary {
  readonly id: string;
  readonly unitNumber: string;
  readonly donationId: string;
  readonly bagNumber: string;
  readonly componentTypeId: string;
  readonly componentName: string;
  readonly bloodGroup: BloodGroup;
  readonly preparedOn: string;
  readonly expiresOn: string;
  readonly status: UnitStatus;
  readonly requestId: string | null;
  readonly version: number;
}

export interface DonationView {
  readonly id: string;
  readonly bagNumber: string;
  readonly donorId: string;
  readonly donorName: string;
  readonly donatedOn: string;
  readonly bloodGroup: BloodGroup;
  readonly volumeMl: number;
  readonly status: 'collected' | 'screened' | 'discarded';
  readonly screens: Record<Screen, ScreenResult | null>;
  readonly discardReason: string | null;
  readonly version: number;
  readonly units: UnitSummary[];
}

export interface RequestFilter extends PageRequest {
  readonly status?: 'open' | 'fulfilled' | 'cancelled' | undefined;
  readonly patientId?: string | undefined;
}

export interface RequestSummary {
  readonly id: string;
  readonly number: string;
  readonly patientId: string;
  readonly admissionId: string | null;
  readonly billId: string | null;
  readonly componentTypeId: string;
  readonly componentName: string;
  readonly units: number;
  readonly issued: number;
  readonly bloodGroup: BloodGroup;
  readonly requestedOn: string;
  readonly status: 'open' | 'fulfilled' | 'cancelled';
  readonly version: number;
}

export interface RequestView extends RequestSummary {
  readonly reason: string | null;
  readonly crossmatches: {
    readonly unitId: string;
    readonly unitNumber: string;
    readonly result: 'compatible' | 'incompatible';
    readonly method: string | null;
    readonly doneAt: Date;
  }[];
  readonly issues: {
    readonly id: string;
    readonly number: string;
    readonly unitId: string;
    readonly unitNumber: string;
    readonly issuedAt: Date;
    readonly amount: number;
  }[];
}

export interface IssueRecord {
  readonly id: string;
  readonly number: string;
  readonly issuedAt: Date;
  readonly amount: number;
  readonly issuedBy: string | null;
  readonly requestNumber: string;
  readonly patientId: string;
  readonly admissionId: string | null;
  readonly patientGroup: BloodGroup;
  readonly unitNumber: string;
  readonly bagNumber: string;
  readonly componentName: string;
  readonly unitGroup: BloodGroup;
  readonly expiresOn: string;
  readonly crossmatch: string | null;
}

export abstract class BloodReadRepository {
  abstract donors(filter: DonorFilter): Promise<Page<DonorSummary>>;
  abstract donation(id: string): Promise<DonationView | null>;
  abstract units(filter: UnitFilter): Promise<Page<UnitSummary>>;
  abstract requests(filter: RequestFilter): Promise<Page<RequestSummary>>;
  abstract request(id: string): Promise<RequestView | null>;
  abstract issue(id: string): Promise<IssueRecord | null>;
}

export interface DonorInput {
  readonly fullName: string;
  readonly sex: 'male' | 'female' | 'other';
  readonly dateOfBirth: string;
  readonly bloodGroup: BloodGroup;
  readonly mobileNo: string | null;
  readonly address: string | null;
}

export class RegisterDonorCommand extends Command<{ id: string; number: string }> {
  constructor(
    readonly actor: Actor,
    readonly input: DonorInput,
  ) {
    super();
  }
}

export class TakeDonationCommand extends Command<{ id: string; bagNumber: string }> {
  constructor(
    readonly actor: Actor,
    readonly donorId: string,
    readonly volumeMl: number,
  ) {
    super();
  }
}

export class ScreenDonationCommand extends Command<{ status: string; units: number }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly results: Record<Screen, ScreenResult>,
  ) {
    super();
  }
}

export class PrepareComponentsCommand extends Command<{ units: { id: string; unitNumber: string }[] }> {
  constructor(
    readonly actor: Actor,
    readonly donationId: string,
    readonly componentTypeIds: readonly string[],
  ) {
    super();
  }
}

export class DiscardUnitCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly reason: string,
  ) {
    super();
  }
}

export interface RequestInput {
  readonly patientId: string;
  /** For a stay (charged to it) … */
  readonly admissionId: string | null;
  /** … or on a diagnostic bill of the patient (paid there). */
  readonly billNumber: string | null;
  readonly componentTypeId: string;
  readonly units: number;
  readonly reason: string | null;
}

export class RequestBloodCommand extends Command<{ id: string; number: string }> {
  constructor(
    readonly actor: Actor,
    readonly input: RequestInput,
  ) {
    super();
  }
}

export class CrossmatchCommand extends Command<{ result: 'compatible' | 'incompatible' }> {
  constructor(
    readonly actor: Actor,
    readonly requestId: string,
    readonly unitId: string,
    readonly result: 'compatible' | 'incompatible',
    readonly method: string | null,
  ) {
    super();
  }
}

export class IssueBloodCommand extends Command<{ id: string; number: string; amount: number; status: string }> {
  constructor(
    readonly actor: Actor,
    readonly requestId: string,
    readonly unitId: string,
  ) {
    super();
  }
}

export class CancelRequestCommand extends Command<{ released: number }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
  ) {
    super();
  }
}

export class ListDonorsQuery extends Query<Page<DonorSummary>> {
  constructor(
    readonly actor: Actor,
    readonly filter: DonorFilter,
  ) {
    super();
  }
}

export class GetDonationQuery extends Query<DonationView> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}

export class ListUnitsQuery extends Query<Page<UnitSummary>> {
  constructor(
    readonly actor: Actor,
    readonly filter: UnitFilter,
  ) {
    super();
  }
}

export class ListRequestsQuery extends Query<Page<RequestSummary>> {
  constructor(
    readonly actor: Actor,
    readonly filter: RequestFilter,
  ) {
    super();
  }
}

export class GetRequestQuery extends Query<RequestView> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}
