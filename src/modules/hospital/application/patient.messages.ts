import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page, PageRequest } from '../../../shared/application/pagination.js';
import type { StoredFile } from '../../../shared/domain/uploads.js';
import type { Age, BloodGroup, IdType, MaritalStatus, PatientInput, Sex } from '../domain/patient.js';
import type { PatientMatch } from '../domain/repositories.js';

export const PATIENT_READ = 'patient:read';
export const PATIENT_REGISTER = 'patient:register';
export const PATIENT_MANAGE = 'patient:manage';

export interface PatientFilter extends PageRequest {
  /** A UHID (with or without prefix), a mobile number, or part of a name. */
  readonly q?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly status?: 'active' | 'inactive' | 'all' | undefined;
}

export interface PatientSummary {
  readonly id: string;
  readonly uhid: number;
  readonly title: string | null;
  readonly fullName: string;
  readonly sex: Sex;
  readonly dateOfBirth: string;
  readonly birthEstimated: boolean;
  readonly mobileNo: string;
  readonly registeredOn: string;
  readonly confidential: boolean;
  readonly isActive: boolean;
}

export interface PatientView extends PatientSummary {
  readonly bloodGroup: BloodGroup | null;
  readonly maritalStatus: MaritalStatus | null;
  readonly religion: string | null;
  readonly occupation: string | null;
  readonly fatherName: string | null;
  readonly motherName: string | null;
  readonly spouseName: string | null;
  readonly email: string | null;
  readonly idType: IdType | null;
  readonly idNo: string | null;
  readonly careOf: string | null;
  readonly houseNo: string | null;
  readonly roadNo: string | null;
  readonly village: string | null;
  readonly postOffice: string | null;
  readonly area: string | null;
  readonly districtId: string | null;
  readonly districtName: string | null;
  readonly contactName: string | null;
  readonly contactRelation: string | null;
  readonly contactMobileNo: string | null;
  readonly contactAddress: string | null;
  readonly specialAlert: string | null;
  readonly registeredBy: string | null;
  readonly inactiveReason: string | null;
  readonly hasPhoto: boolean;
  readonly version: number;
}

/** A patient as shown: with the age today. */
export type WithAge<T> = T & { readonly age: Age };

export abstract class PatientReadRepository {
  abstract list(filter: PatientFilter & { uhid: number | null }): Promise<Page<PatientSummary>>;
  /** The view without the district name (the location module has it). */
  abstract get(id: string): Promise<Omit<PatientView, 'districtName'> | null>;
  abstract idOfUhid(uhid: number): Promise<string | null>;
  abstract photo(id: string): Promise<StoredFile | null>;
  /** Patients registered over a period, oldest first (the registration register). */
  abstract registered(from: string, to: string): Promise<(PatientSummary & { districtId: string | null })[]>;
}

export class RegisterPatientCommand extends Command<{ id: string; uhid: number }> {
  constructor(
    readonly actor: Actor,
    readonly input: PatientInput,
    /** Registered although a patient with the same mobile and name or birth date exists. */
    readonly allowDuplicate: boolean,
  ) {
    super();
  }
}

export class ChangePatientCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly input: PatientInput,
  ) {
    super();
  }
}

export class DeactivatePatientCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly reason: string,
  ) {
    super();
  }
}

export class ReactivatePatientCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
  ) {
    super();
  }
}

export class SetPatientPhotoCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly contentType: string,
    readonly data: Uint8Array,
  ) {
    super();
  }
}

export class RemovePatientPhotoCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}

export class ListPatientsQuery extends Query<Page<WithAge<PatientSummary>>> {
  constructor(
    readonly actor: Actor,
    readonly filter: PatientFilter,
  ) {
    super();
  }
}

export class GetPatientQuery extends Query<WithAge<PatientView>> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}

export class GetPatientByUhidQuery extends Query<WithAge<PatientView>> {
  constructor(
    readonly actor: Actor,
    readonly uhid: string,
  ) {
    super();
  }
}

/** Who might be the same person: the check the counter makes before registering. */
export class FindPatientMatchesQuery extends Query<PatientMatch[]> {
  constructor(
    readonly actor: Actor,
    readonly mobileNo: string,
    readonly fullName: string,
    readonly dateOfBirth: string | null,
  ) {
    super();
  }
}

export class GetPatientPhotoQuery extends Query<StoredFile> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}
