import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { Medicine } from '../../../shared/application/contracts/medicine-catalogue.js';
import type { Page, PageRequest } from '../../../shared/application/pagination.js';
import type { Phrase } from '../domain/repositories.js';
import type {
  Complaint,
  DrugLine,
  PhraseKind,
  PrescriptionProps,
  RxStatus,
  TemplateProps,
  TestLine,
  Vitals,
} from '../domain/prescription.js';

/** Seeing prescriptions, the pick lists and the medicines and tests to prescribe. */
export const RX_READ = 'rx:read';
/** The doctor's assistant: opening visits, taking vitals, cancelling a visit the patient left. */
export const RX_VITALS = 'rx:vitals';
/** A doctor (signed in as one): writing, signing and correcting their own prescriptions; their own lists. */
export const RX_WRITE = 'rx:write';
/** Pick lists shared by every doctor. */
export const RX_MANAGE = 'rx:manage';

/** The organisation's time zone, for the visit's day. */
export const CLINICAL_SETTINGS = Symbol('CLINICAL_SETTINGS');
export interface ClinicalSettings {
  readonly timeZone: string;
}

export interface RxFilter extends PageRequest {
  readonly doctorId?: string | undefined;
  readonly patientId?: string | undefined;
  readonly status?: RxStatus | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly number?: string | undefined;
}

export interface RxRow {
  readonly id: string;
  readonly number: string;
  readonly patientId: string;
  readonly doctorId: string;
  readonly appointmentId: string | null;
  readonly visitNo: number;
  readonly visitOn: string;
  readonly status: RxStatus;
  readonly diagnosis: string | null;
  readonly signedAt: Date | null;
}

export interface RxSummary extends RxRow {
  readonly patientName: string;
  readonly uhid: number | null;
  readonly doctorName: string;
}

export type RxRecord = Omit<PrescriptionProps, 'createdAt'>;

export interface RxView extends RxRecord {
  readonly patient: {
    readonly id: string;
    readonly uhid: number;
    readonly name: string;
    readonly sex: string;
    readonly dateOfBirth: string;
    readonly bloodGroup: string | null;
  };
  readonly doctor: {
    readonly id: string;
    readonly name: string;
    readonly degrees: string | null;
    readonly specialityName: string | null;
  };
  readonly bmi: number | null;
}

export interface PhraseFilter {
  readonly kind?: PhraseKind | undefined;
  readonly q?: string | undefined;
  readonly genericId?: string | undefined;
}

export abstract class ClinicalReadRepository {
  abstract prescriptions(filter: RxFilter): Promise<Page<RxRow>>;
  abstract prescription(id: string): Promise<RxRecord | null>;
  /** Shared phrases and the doctor's own (doses of a generic with the general ones). */
  abstract phrases(doctorId: string | null, filter: PhraseFilter): Promise<Phrase[]>;
  abstract templates(doctorId: string): Promise<{ id: string; name: string; diagnosis: string | null }[]>;
}

export interface OpenInput {
  /** A chamber appointment of today… */
  readonly appointmentId: string | null;
  /** …or a registered patient seen by a doctor without one. */
  readonly patientId: string | null;
  readonly doctorId: string | null;
}

export class OpenPrescriptionCommand extends Command<{ id: string; number: string }> {
  constructor(
    readonly actor: Actor,
    readonly input: OpenInput,
  ) {
    super();
  }
}

export class RecordVitalsCommand extends Command<{ version: number }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly vitals: Vitals,
  ) {
    super();
  }
}

/** A medicine of the catalogue (named from it) or one written by name. */
export type DrugInput = Omit<DrugLine, 'name'> & { readonly name: string | null };
/** A test of the catalogue (named from it) or one written by name. */
export type TestInput = Omit<TestLine, 'name'> & { readonly name: string | null };

export interface ContentInput {
  readonly complaints: Complaint[];
  readonly history: string | null;
  readonly pastHistory: string | null;
  readonly drugHistory: string | null;
  readonly examination: string | null;
  readonly diagnosis: string | null;
  readonly treatmentPlan: string | null;
  readonly notes: string | null;
  readonly followUpOn: string | null;
  readonly followUpNote: string | null;
  readonly referral: string | null;
  readonly drugs: DrugInput[];
  readonly tests: TestInput[];
  readonly advices: string[];
}

export class WritePrescriptionCommand extends Command<{ version: number }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly content: ContentInput,
  ) {
    super();
  }
}

export class SignPrescriptionCommand extends Command<{ version: number }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
  ) {
    super();
  }
}

export class ReopenPrescriptionCommand extends Command<{ version: number }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
  ) {
    super();
  }
}

export class CancelPrescriptionCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly reason: string | null,
  ) {
    super();
  }
}

export interface PhraseInput {
  readonly kind: PhraseKind;
  readonly text: string;
  readonly shortKey: string | null;
  readonly genericId: string | null;
  /** For every doctor (needs rx:manage) rather than the doctor's own. */
  readonly shared: boolean;
}

export class CreatePhraseCommand extends Command<{ id: string }> {
  constructor(
    readonly actor: Actor,
    readonly input: PhraseInput,
  ) {
    super();
  }
}

export class UpdatePhraseCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly text: string,
    readonly shortKey: string | null,
  ) {
    super();
  }
}

export class DeletePhraseCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}

export interface TemplateInput {
  readonly name: string;
  readonly diagnosis: string | null;
  readonly drugs: DrugInput[];
  readonly tests: TestInput[];
  readonly advices: string[];
}

export class CreateTemplateCommand extends Command<{ id: string }> {
  constructor(
    readonly actor: Actor,
    readonly input: TemplateInput,
  ) {
    super();
  }
}

export class UpdateTemplateCommand extends Command<{ version: number }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly input: TemplateInput,
  ) {
    super();
  }
}

export class DeleteTemplateCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}

export class ListPrescriptionsQuery extends Query<Page<RxSummary>> {
  constructor(
    readonly actor: Actor,
    readonly filter: RxFilter & { readonly mine?: boolean | undefined },
  ) {
    super();
  }
}

export class GetPrescriptionQuery extends Query<RxView> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}

export class ListPhrasesQuery extends Query<Phrase[]> {
  constructor(
    readonly actor: Actor,
    readonly filter: PhraseFilter,
  ) {
    super();
  }
}

export class ListTemplatesQuery extends Query<{ id: string; name: string; diagnosis: string | null }[]> {
  constructor(readonly actor: Actor) {
    super();
  }
}

export class GetTemplateQuery extends Query<TemplateProps> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}

export class SearchMedicinesQuery extends Query<Medicine[]> {
  constructor(
    readonly actor: Actor,
    readonly text: string,
  ) {
    super();
  }
}

export class SearchTestsQuery extends Query<{ id: string; name: string; departmentKind: string }[]> {
  constructor(
    readonly actor: Actor,
    readonly text: string,
  ) {
    super();
  }
}
