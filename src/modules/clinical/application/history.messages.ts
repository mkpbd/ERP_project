import { Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';

/** What the old system's clinical records are (step 13f). */
export const HISTORY_KINDS = ['prescription', 'lab-report', 'imaging-report', 'discharge-summary', 'note'] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];

export interface HistoryEntry {
  readonly id: string;
  readonly kind: HistoryKind;
  readonly title: string;
  readonly number: string | null;
  readonly recordedOn: string;
  readonly author: string | null;
  readonly shared: boolean;
}

export interface HistoryValue {
  readonly test: string;
  readonly result: string;
  readonly unit: string | null;
  readonly reference: string | null;
}

export interface HistoryRecordView extends HistoryEntry {
  readonly patientId: string;
  readonly body: string;
  readonly values: HistoryValue[];
}

/** One result of a test over time; `value` when the result is a number. */
export interface TrendPoint {
  readonly recordId: string;
  readonly recordedOn: string;
  readonly number: string | null;
  readonly result: string;
  readonly value: number | null;
  readonly unit: string | null;
  readonly reference: string | null;
}

export abstract class HistoryReadRepository {
  /** A patient's records, newest first. */
  abstract list(patientId: string, kind?: HistoryKind): Promise<HistoryEntry[]>;
  abstract find(id: string): Promise<HistoryRecordView | null>;
  /** A patient's results of a test (by name, any case), oldest first. */
  abstract trend(patientId: string, test: string): Promise<TrendPoint[]>;
  /** A patient's shared records, for the patient portal. */
  abstract shared(patientId: string): Promise<HistoryEntry[]>;
}

export class ListHistoryQuery extends Query<HistoryEntry[]> {
  constructor(
    readonly actor: Actor,
    readonly patientId: string,
    readonly kind?: HistoryKind,
  ) {
    super();
  }
}

export class GetHistoryRecordQuery extends Query<HistoryRecordView> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}

export class LabTrendQuery extends Query<TrendPoint[]> {
  constructor(
    readonly actor: Actor,
    readonly patientId: string,
    readonly test: string,
  ) {
    super();
  }
}
