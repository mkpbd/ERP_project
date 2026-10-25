import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { RosterEntry } from '../domain/roster.js';

export interface RosterShiftView {
  readonly id: string;
  readonly shiftTypeId: string;
  readonly code: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly remarks: string | null;
}

/** One cell of the roster grid. `version` changes whenever the cell changes (optimistic concurrency). */
export interface RosterDayView {
  readonly staffId: string;
  readonly date: string;
  readonly shifts: RosterShiftView[];
  readonly dayOff: boolean;
  readonly dayOffRemarks: string | null;
  readonly version: string;
}

export interface RosterStaffView {
  readonly id: string;
  readonly employeeNo: string;
  readonly fullName: string;
  readonly designationName: string;
  /** False for people listed only because they have duties here this month (moved or inactive since). */
  readonly inScope: boolean;
}

export interface RosterMonthView {
  readonly departmentId: string;
  readonly subDepartmentId: string;
  readonly year: number;
  readonly month: number;
  readonly staff: RosterStaffView[];
  readonly shiftTypes: Array<{ id: string; code: string; name: string; startTime: string; endTime: string }>;
  /** Only cells that have a duty or a day off. */
  readonly days: RosterDayView[];
  readonly govtHolidays: Array<{ date: string; name: string }>;
}

export type RosterEntryStatus = 'saved' | 'unchanged' | 'invalid' | 'conflict';

export interface RosterEntryResult {
  readonly staffId: string;
  readonly date: string;
  readonly status: RosterEntryStatus;
  readonly errors: string[];
  readonly current: RosterDayView;
}

export interface RosterMonthRef {
  readonly departmentId: string;
  readonly subDepartmentId: string;
  readonly year: number;
  readonly month: number;
}

export class GetRosterMonthQuery extends Query<RosterMonthView> {
  constructor(
    readonly actor: Actor,
    readonly month: RosterMonthRef,
  ) {
    super();
  }
}

export class SaveRosterEntriesCommand extends Command<{ results: RosterEntryResult[]; saved: number; failed: number }> {
  constructor(
    readonly actor: Actor,
    readonly month: RosterMonthRef,
    readonly entries: ReadonlyArray<RosterEntry & { readonly expectedVersion: string }>,
  ) {
    super();
  }
}

/** Your own duties and days off (linked staff record). */
export class GetMyRosterQuery extends Query<RosterDayView[]> {
  constructor(
    readonly actor: Actor,
    readonly from: string,
    readonly to: string,
  ) {
    super();
  }
}
