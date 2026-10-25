import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page } from '../../../shared/application/pagination.js';
import type { SalarySettings } from '../domain/salary.js';
import type {
  IncrementCandidate,
  IncrementFilter,
  SalaryIncrementView,
  SalaryListFilter,
  StaffSalaryView,
} from './read-models.js';

export class SetStaffSalaryCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly staffId: string,
    readonly gross: number,
    readonly settings: SalarySettings,
  ) {
    super();
  }
}

export class ReviseStaffSalaryCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly staffId: string,
    readonly version: number,
    readonly gross: number | undefined,
    readonly settings: Partial<SalarySettings>,
  ) {
    super();
  }
}

export interface IncrementEntry {
  readonly staffId: string;
  /** Defaults to what the person's method gives; required for the individual method. */
  readonly amount?: number | undefined;
  /** Defaults to the anniversary-month arrear when the increment is due, else 0. */
  readonly arrear?: number | undefined;
}

export class ApplyIncrementsCommand extends Command<{ applied: number }> {
  constructor(
    readonly actor: Actor,
    readonly year: number,
    readonly month: number,
    readonly entries: readonly IncrementEntry[],
  ) {
    super();
  }
}

export class CommitIncrementsCommand extends Command<{ committed: number }> {
  constructor(
    readonly actor: Actor,
    readonly year: number,
    readonly month: number,
  ) {
    super();
  }
}

export class ReverseIncrementsCommand extends Command<{ reversed: number }> {
  constructor(
    readonly actor: Actor,
    readonly year: number,
    readonly month: number,
  ) {
    super();
  }
}

export class ListSalariesQuery extends Query<Page<StaffSalaryView>> {
  constructor(
    readonly actor: Actor,
    readonly filter: SalaryListFilter,
  ) {
    super();
  }
}

/** Without a staff id: the actor's own salary. */
export class GetSalaryQuery extends Query<StaffSalaryView> {
  constructor(
    readonly actor: Actor,
    readonly staffId?: string,
  ) {
    super();
  }
}

export class ListIncrementsQuery extends Query<SalaryIncrementView[]> {
  constructor(
    readonly actor: Actor,
    readonly filter: IncrementFilter,
  ) {
    super();
  }
}

export class GetIncrementCandidatesQuery extends Query<IncrementCandidate[]> {
  constructor(
    readonly actor: Actor,
    readonly year: number,
    readonly month: number,
  ) {
    super();
  }
}
