import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page, PageRequest } from '../../../shared/application/pagination.js';
import type { CultureReport, ReportForm, Sensitivity } from '../domain/culture.js';
import type { Parameter, ResultStatus, ResultValue, SampleStatus } from '../domain/lab.js';

/** The culture masters and the written reports' templates (record endpoints under /lab). */
export const LAB_RECORDS = {
  antibiotic: 'lab_antibiotic',
  organism: 'lab_organism',
  growthType: 'lab_growth_type',
  cultureMessage: 'lab_culture_message',
  reportTemplate: 'lab_report_template',
} as const;

/** The organisation's time zone, for the lab's days. */
export const LAB_SETTINGS = Symbol('LAB_SETTINGS');
export interface LabSettings {
  readonly timeZone: string;
}

/** Seeing samples, worklists and results. */
export const LAB_READ = 'lab:read';
/** Keeping the tests' parameters and ranges; handing over a report while the patient still owes. */
export const LAB_MANAGE = 'lab:manage';
/** Collecting samples from patients. */
export const LAB_COLLECT = 'lab:collect';
/** Taking samples in or rejecting them, entering results and handing reports over. */
export const LAB_RESULT = 'lab:result';
/** Verifying results (a pathologist) and taking a verification back. */
export const LAB_VERIFY = 'lab:verify';

export interface SampleFilter extends PageRequest {
  readonly status?: SampleStatus | undefined;
  readonly departmentId?: string | undefined;
  readonly billId?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

export interface SampleSummary {
  readonly id: string;
  readonly labNumber: string;
  readonly billId: string;
  readonly departmentId: string;
  readonly patientId: string;
  readonly collectedOn: string;
  readonly collectedAt: Date;
  readonly status: SampleStatus;
  readonly tests: number;
  readonly verified: number;
  readonly version: number;
}

export interface ResultFilter extends PageRequest {
  readonly status?: ResultStatus | undefined;
  readonly sampleId?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

export interface ResultSummary {
  readonly id: string;
  readonly sampleId: string;
  readonly labNumber: string;
  readonly billId: string;
  readonly line: number;
  readonly testId: string;
  readonly status: ResultStatus;
  readonly collectedAt: Date;
  readonly version: number;
}

export interface ResultRecord extends ResultSummary {
  readonly comment: string | null;
  readonly enteredBy: string | null;
  readonly enteredAt: Date | null;
  readonly verifiedBy: string | null;
  readonly verifiedAt: Date | null;
  readonly deliveredTo: string | null;
  readonly deliveredAt: Date | null;
  /** Reagents used up when verified (short: to enter by hand); null: none set. */
  readonly reagents: 'used' | 'short' | null;
  /** How it was entered (null while pending). */
  readonly form: ReportForm | null;
  readonly values: ResultValue[];
  readonly culture: CultureReport | null;
  readonly narrative: string | null;
}

export abstract class LabReadRepository {
  abstract samples(filter: SampleFilter): Promise<Page<SampleSummary>>;
  abstract sample(
    id: string,
  ): Promise<(SampleSummary & { rejectReason: string | null; results: ResultRecord[] }) | null>;
  abstract results(filter: ResultFilter): Promise<Page<ResultSummary>>;
  abstract result(id: string): Promise<ResultRecord | null>;
}

/** What the order says about a document of the lab: the bill, the patient and the test. */
export interface OrderRef {
  readonly billNumber: string | null;
  readonly patientName: string | null;
  readonly uhid: number | null;
  readonly testName?: string | null;
  readonly departmentName?: string | null;
}

export class SetTestParametersCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly testId: string,
    readonly parameters: readonly Omit<Parameter, 'id'>[],
  ) {
    super();
  }
}

/** How a lab test is reported: values (its parameters), a culture, or written text. */
export class SetTestFormCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly testId: string,
    readonly form: ReportForm,
  ) {
    super();
  }
}

export class GetTestFormQuery extends Query<{ form: ReportForm }> {
  constructor(
    readonly actor: Actor,
    readonly testId: string,
  ) {
    super();
  }
}

/** Lab tests of the catalogue by name, code or short name, with how each is reported. */
export class SearchLabTestsQuery extends Query<{ id: string; name: string; form: ReportForm }[]> {
  constructor(
    readonly actor: Actor,
    readonly q: string,
  ) {
    super();
  }
}

/** A bill to collect from, by its number: each lab department's tests, and whether each is in work already. */
export interface CollectableOrder {
  readonly billId: string;
  readonly billNumber: string;
  readonly billedAt: Date;
  readonly patientName: string;
  readonly uhid: number;
  readonly sex: string;
  readonly dateOfBirth: string;
  readonly departments: {
    readonly departmentId: string;
    readonly departmentName: string;
    readonly tests: { readonly line: number; readonly testName: string; readonly inWork: boolean }[];
  }[];
}

export class FindOrderQuery extends Query<CollectableOrder> {
  constructor(
    readonly actor: Actor,
    readonly number: string,
  ) {
    super();
  }
}

/** A culture as entered: masters by id (their names are copied), the rest as written. */
export interface CultureInput {
  readonly analyzer: string | null;
  readonly pusCells: string | null;
  readonly epithelialCells: string | null;
  readonly rbc: string | null;
  readonly microscopyNote: string | null;
  readonly growth: boolean;
  readonly growthTypeId: string | null;
  readonly organismIds: readonly string[];
  readonly colonyCount: string | null;
  readonly incubation: string | null;
  readonly media: string | null;
  readonly message: string | null;
  readonly sensitivity: readonly {
    readonly antibioticId: string;
    readonly zone: string | null;
    readonly results: readonly (Sensitivity | null)[];
  }[];
}

export class GetTestParametersQuery extends Query<Parameter[]> {
  constructor(
    readonly actor: Actor,
    readonly testId: string,
  ) {
    super();
  }
}

export class CollectSampleCommand extends Command<{ id: string; labNumber: string; tests: number }> {
  constructor(
    readonly actor: Actor,
    readonly billId: string,
    readonly departmentId: string,
  ) {
    super();
  }
}

export type SampleChange =
  | { readonly kind: 'receive' }
  | { readonly kind: 'reject'; readonly reason: string }
  | { readonly kind: 'deliver'; readonly to: string };

export class ChangeSampleCommand extends Command<{ results: number }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly change: SampleChange,
  ) {
    super();
  }
}

export type ResultChange =
  | {
      readonly kind: 'enter';
      readonly values: readonly { readonly parameterId: string; readonly value: string | null }[];
      readonly comment: string | null;
    }
  | { readonly kind: 'enter-culture'; readonly culture: CultureInput; readonly comment: string | null }
  | { readonly kind: 'enter-text'; readonly narrative: string; readonly comment: string | null }
  | { readonly kind: 'verify' }
  | { readonly kind: 'unverify' };

export class ChangeResultCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly change: ResultChange,
  ) {
    super();
  }
}

export class ListSamplesQuery extends Query<Page<SampleSummary & OrderRef>> {
  constructor(
    readonly actor: Actor,
    readonly filter: SampleFilter,
  ) {
    super();
  }
}

export class GetSampleQuery extends Query<unknown> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}

export class ListResultsQuery extends Query<Page<ResultSummary & OrderRef>> {
  constructor(
    readonly actor: Actor,
    readonly filter: ResultFilter,
  ) {
    super();
  }
}

/** A result with its template for the patient (each parameter's range for their sex and age) to enter against. */
export class GetResultQuery extends Query<unknown> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}
