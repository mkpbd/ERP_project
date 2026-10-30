import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { OfficerPerformance, Person, PersonKind } from '../domain/team.js';

/** Seeing the marketing team, zones, doctors looked after, targets and performance. */
export const MKT_READ = 'mkt:read';
/** Keeping the team, zones and areas, the doctors each officer looks after, and targets. */
export const MKT_MANAGE = 'mkt:manage';

export const MARKETING_RECORDS = { zone: 'marketing_zone', area: 'marketing_area' } as const;

export interface PersonView extends Person {
  readonly parentName: string | null;
  readonly zoneName: string | null;
}

export interface Performance {
  readonly year: number;
  readonly month: number;
  readonly rows: OfficerPerformance[];
  /** All referred billing, assigned or not, and what no officer looks after. */
  readonly total: number;
  readonly unassigned: number;
  readonly grossTarget: number | null;
  readonly grossPercent: number | null;
}

export abstract class MarketingRepository {
  abstract person(id: string): Promise<Person | null>;
  abstract insertPerson(person: Person): Promise<void>;
  abstract updatePerson(person: Person): Promise<void>;
  /** Someone works under them. */
  abstract hasReports(id: string): Promise<boolean>;
  abstract zoneExists(id: string): Promise<boolean>;
  /** Replaces the doctors an officer looks after (a doctor moves from any other officer). */
  abstract setDoctors(officerId: string, doctorIds: readonly string[]): Promise<void>;
  abstract setTarget(officerId: string | null, year: number, month: number, amount: number | null): Promise<void>;
}

export abstract class MarketingReadRepository {
  abstract people(kind?: PersonKind): Promise<PersonView[]>;
  abstract doctorsOf(officerId: string): Promise<string[]>;
  /** Doctor → officer. */
  abstract links(): Promise<Map<string, string>>;
  /** Officer (null: gross) → amount. */
  abstract targets(year: number, month: number): Promise<Map<string | null, number>>;
}

export interface PersonInput {
  readonly kind: PersonKind;
  readonly name: string;
  readonly code: string | null;
  readonly phone: string | null;
  readonly parentId: string | null;
  readonly zoneId: string | null;
}

export class CreatePersonCommand extends Command<{ id: string }> {
  constructor(
    readonly actor: Actor,
    readonly input: PersonInput,
  ) {
    super();
  }
}

export class UpdatePersonCommand extends Command<{ version: number }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly input: Omit<PersonInput, 'kind'> & { readonly isActive: boolean },
  ) {
    super();
  }
}

export class SetOfficerDoctorsCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly officerId: string,
    readonly doctorIds: readonly string[],
  ) {
    super();
  }
}

export class SetTargetCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly officerId: string | null,
    readonly year: number,
    readonly month: number,
    /** Null removes the target. */
    readonly amount: number | null,
  ) {
    super();
  }
}

export class ListPeopleQuery extends Query<PersonView[]> {
  constructor(
    readonly actor: Actor,
    readonly kind?: PersonKind,
  ) {
    super();
  }
}

export class OfficerDoctorsQuery extends Query<{ id: string; name: string }[]> {
  constructor(
    readonly actor: Actor,
    readonly officerId: string,
  ) {
    super();
  }
}

export class PerformanceQuery extends Query<Performance> {
  constructor(
    readonly actor: Actor,
    readonly year: number,
    readonly month: number,
  ) {
    super();
  }
}
