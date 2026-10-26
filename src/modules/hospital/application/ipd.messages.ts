import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page, PageRequest } from '../../../shared/application/pagination.js';
import type { AdmissionKind, AdmissionStatus, DischargeType } from '../domain/admission.js';
import type { BedStatus } from '../domain/repositories.js';

/** Seeing admissions, the bed board and the census. */
export const IPD_READ = 'ipd:read';
/** Admitting patients, moving them between beds, changing their doctors and discharging them. */
export const IPD_ADMIT = 'ipd:admit';
/** Wards, bed categories and beds; cancelling an admission; taking a bed out of order. */
export const IPD_MANAGE = 'ipd:manage';

export interface AdmissionFilter extends PageRequest {
  readonly status?: AdmissionStatus | undefined;
  readonly patientId?: string | undefined;
  readonly doctorId?: string | undefined;
  readonly wardId?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

export interface AdmissionSummary {
  readonly id: string;
  readonly number: string;
  readonly patientId: string;
  readonly uhid: number;
  readonly patientName: string;
  readonly admittedAt: Date;
  readonly kind: AdmissionKind;
  readonly status: AdmissionStatus;
  readonly dischargedAt: Date | null;
  readonly dischargeType: DischargeType | null;
  /** The bed now, or the last one. */
  readonly bedCode: string | null;
  readonly wardName: string | null;
  readonly doctorName: string | null;
  readonly version: number;
}

export interface AdmissionView extends AdmissionSummary {
  readonly sex: string;
  readonly dateOfBirth: string;
  readonly mobileNo: string | null;
  readonly reason: string | null;
  readonly referredById: string | null;
  readonly referredByName: string | null;
  readonly corporateClientId: string | null;
  readonly corporateClientName: string | null;
  readonly staffId: string | null;
  readonly admissionFee: number;
  readonly dischargeNote: string | null;
  readonly cancelReason: string | null;
  readonly admittedBy: string | null;
  readonly closedBy: string | null;
  readonly stays: {
    readonly bedId: string;
    readonly bedCode: string;
    readonly wardName: string;
    readonly categoryName: string;
    readonly fromAt: Date;
    readonly toAt: Date | null;
    readonly dailyRate: number;
    readonly reason: string | null;
  }[];
  readonly doctors: {
    readonly doctorId: string;
    readonly doctorName: string;
    readonly role: 'primary' | 'additional';
    readonly fromAt: Date;
    readonly toAt: Date | null;
  }[];
}

export interface BoardBed {
  readonly id: string;
  readonly code: string;
  readonly categoryName: string;
  readonly isIntensive: boolean;
  readonly status: BedStatus;
  readonly dailyRate: number;
  readonly admission: {
    readonly id: string;
    readonly number: string;
    readonly patientName: string;
    readonly uhid: number;
    readonly since: Date;
    readonly doctorName: string | null;
  } | null;
}

export interface BedBoard {
  readonly wards: {
    readonly id: string;
    readonly name: string;
    readonly floor: string | null;
    readonly beds: BoardBed[];
  }[];
  readonly counts: Record<BedStatus, number>;
}

export abstract class AdmissionReadRepository {
  abstract list(filter: AdmissionFilter): Promise<Page<AdmissionSummary>>;
  abstract get(id: string): Promise<AdmissionView | null>;
  abstract board(wardId?: string): Promise<BedBoard>;
}

export interface AdmitInput {
  readonly patientId: string;
  readonly bedId: string;
  readonly doctorId: string;
  readonly additionalDoctorIds: readonly string[];
  readonly kind: AdmissionKind;
  readonly reason: string | null;
  readonly referredById: string | null;
  /** Left out (undefined): the patient's own corporate client, if any. */
  readonly corporateClientId?: string | null | undefined;
  readonly staffId: string | null;
}

export class AdmitPatientCommand extends Command<{ id: string; number: string }> {
  constructor(
    readonly actor: Actor,
    readonly input: AdmitInput,
  ) {
    super();
  }
}

export type AdmissionChange =
  | { readonly kind: 'transfer'; readonly bedId: string; readonly reason: string }
  | { readonly kind: 'consultant'; readonly doctorId: string }
  | { readonly kind: 'additional'; readonly doctorIds: readonly string[] }
  | { readonly kind: 'discharge'; readonly type: DischargeType; readonly note: string | null }
  | { readonly kind: 'cancel'; readonly reason: string };

export class ChangeAdmissionCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly change: AdmissionChange,
  ) {
    super();
  }
}

/** A bed made ready after housekeeping, taken out of order, or back in order. */
export class SetBedStatusCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly bedId: string,
    readonly status: 'available' | 'out_of_order',
  ) {
    super();
  }
}

export class ListAdmissionsQuery extends Query<Page<AdmissionSummary>> {
  constructor(
    readonly actor: Actor,
    readonly filter: AdmissionFilter,
  ) {
    super();
  }
}

export class GetAdmissionQuery extends Query<AdmissionView> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}

export class GetBedBoardQuery extends Query<BedBoard> {
  constructor(
    readonly actor: Actor,
    readonly wardId: string | undefined,
  ) {
    super();
  }
}
