import type { BloodGroup, BloodRequest, BloodUnit, Compatibility, Donation } from './blood.js';

export interface ComponentType {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly shelfDays: number;
  readonly compatibility: Compatibility;
  readonly rate: number;
  readonly isActive: boolean;
}

export interface Donor {
  readonly id: string;
  readonly number: string;
  readonly fullName: string;
  readonly sex: 'male' | 'female' | 'other';
  readonly dateOfBirth: string;
  readonly bloodGroup: BloodGroup;
  readonly mobileNo: string | null;
  readonly address: string | null;
  readonly lastDonatedOn: string | null;
  readonly deferredUntil: string | null;
  readonly deferReason: string | null;
  readonly isActive: boolean;
  readonly version: number;
}

export abstract class BloodRepository {
  /** The next serial of a kind and year, counted under a row lock. */
  abstract nextSerial(kind: string, year: number): Promise<number>;
  abstract componentTypes(ids: readonly string[]): Promise<Map<string, ComponentType>>;
  abstract insertDonor(donor: Donor): Promise<void>;
  abstract donorForUpdate(id: string): Promise<Donor | null>;
  abstract updateDonor(donor: Donor): Promise<void>;
  abstract insertDonation(donation: Donation): Promise<void>;
  abstract donationForUpdate(id: string): Promise<Donation | null>;
  abstract updateDonation(donation: Donation): Promise<void>;
  /** The donation's units, locked. */
  abstract unitsOf(donationId: string): Promise<BloodUnit[]>;
  abstract insertUnit(unit: BloodUnit): Promise<void>;
  abstract unitForUpdate(id: string): Promise<BloodUnit | null>;
  abstract updateUnit(unit: BloodUnit): Promise<void>;
  /** Units kept for a request, locked. */
  abstract reservedFor(requestId: string): Promise<BloodUnit[]>;
  abstract insertRequest(request: BloodRequest): Promise<void>;
  abstract requestForUpdate(id: string): Promise<BloodRequest | null>;
  abstract updateRequest(request: BloodRequest): Promise<void>;
  abstract addCrossmatch(row: {
    requestId: string;
    unitId: string;
    result: 'compatible' | 'incompatible';
    method: string | null;
    doneBy: string;
    doneAt: Date;
  }): Promise<void>;
  abstract addIssue(row: {
    id: string;
    number: string;
    requestId: string;
    unitId: string;
    admissionId: string | null;
    issuedOn: string;
    issuedAt: Date;
    amount: number;
    voucherNumber: string | null;
    issuedBy: string;
  }): Promise<void>;
  abstract issuedCount(requestId: string): Promise<number>;
}
