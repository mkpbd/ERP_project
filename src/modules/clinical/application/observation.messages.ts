import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { ObservationRow } from '../domain/repositories.js';
import type { ObservationInput, RoundState, VitalFlag } from '../domain/observation.js';

export interface ObservationView extends Omit<ObservationRow, 'recordedBy' | 'struckBy'> {
  readonly roundName: string | null;
  readonly recordedByName: string;
  readonly struckByName: string | null;
  readonly flags: VitalFlag[];
}

export interface ObservationBoard {
  readonly day: string;
  readonly rounds: {
    readonly id: string;
    readonly name: string;
    readonly startTime: string;
    readonly endTime: string;
  }[];
  /** Each admitted patient, by ward and bed, with each round's state and the latest observation's flags. */
  readonly patients: {
    readonly admissionId: string;
    readonly admissionNumber: string;
    readonly patientName: string;
    readonly uhid: number;
    readonly wardName: string;
    readonly bedCode: string;
    /** One per round, in the rounds' order (null: before the patient was admitted). */
    readonly rounds: (RoundState | null)[];
    readonly lastAt: Date | null;
    readonly lastFlags: VitalFlag[];
  }[];
}

export abstract class ObservationReadRepository {
  /** The admission's observations taken within [from, to), struck ones too, oldest first. */
  abstract list(admissionId: string, from: Date, to: Date): Promise<ObservationRow[]>;
  /** The rounds answered on a day, by admission: admission id → round ids. */
  abstract answered(admissionIds: readonly string[], day: string): Promise<Map<string, Set<string>>>;
  /** The latest observation (not struck) of each admission. */
  abstract latest(admissionIds: readonly string[]): Promise<Map<string, ObservationRow>>;
  /** Round names by id (inactive ones too). */
  abstract roundNames(): Promise<Map<string, string>>;
}

export class RecordObservationCommand extends Command<{ id: string; flags: VitalFlag[] }> {
  constructor(
    readonly actor: Actor,
    readonly admissionId: string,
    readonly observation: ObservationInput,
    /** Now when not given. */
    readonly takenAt: Date | null,
  ) {
    super();
  }
}

/** An observation entered in error: kept, struck through, with the reason. */
export class StrikeObservationCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly reason: string,
  ) {
    super();
  }
}

export class ListObservationsQuery extends Query<ObservationView[]> {
  constructor(
    readonly actor: Actor,
    readonly admissionId: string,
    /** The days of the organisation's time zone; today when not given. */
    readonly from: string | null,
    readonly to: string | null,
  ) {
    super();
  }
}

export class ObservationBoardQuery extends Query<ObservationBoard> {
  constructor(
    readonly actor: Actor,
    readonly day: string | null,
  ) {
    super();
  }
}
