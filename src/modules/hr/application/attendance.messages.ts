import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page } from '../../../shared/application/pagination.js';
import type { AttendanceStatus, ManualEntryTimes } from '../domain/attendance.js';
import type { ManualAttendanceFilter, ManualAttendanceView, StaffAttendanceRow } from './attendance.read-models.js';

export interface PunchInput {
  readonly biometricNo: number;
  readonly machineNo: number;
  readonly punchedAt: Date;
}

export interface PunchIngestResult {
  readonly received: number;
  readonly accepted: number;
  readonly duplicates: number;
  /** Biometric numbers not assigned to anyone yet; their punches are kept and match once assigned. */
  readonly unmatchedBiometricNos: number[];
}

export class IngestPunchesCommand extends Command<PunchIngestResult> {
  constructor(
    readonly actor: Actor,
    readonly punches: readonly PunchInput[],
  ) {
    super();
  }
}

export class GetDailyAttendanceQuery extends Query<StaffAttendanceRow[]> {
  constructor(
    readonly actor: Actor,
    readonly date: string,
    readonly scope: { departmentId?: string; subDepartmentId?: string },
  ) {
    super();
  }
}

/** `staffId` omitted: your own attendance. */
export class GetStaffAttendanceQuery extends Query<StaffAttendanceRow[]> {
  constructor(
    readonly actor: Actor,
    readonly from: string,
    readonly to: string,
    readonly staffId?: string,
  ) {
    super();
  }
}

export class ListPunchesQuery extends Query<Array<{ punchedAt: Date; machineNo: number }>> {
  constructor(
    readonly actor: Actor,
    readonly staffId: string,
    readonly from: string,
    readonly to: string,
  ) {
    super();
  }
}

export class CreateManualAttendanceCommand extends Command<{ id: string }> {
  constructor(
    readonly actor: Actor,
    readonly staffId: string,
    readonly date: string,
    readonly times: ManualEntryTimes,
    /** Submit for approval right away. */
    readonly submit: boolean,
  ) {
    super();
  }
}

export type ManualAction = 'edit' | 'submit' | 'approve' | 'reject' | 'cancel';

export class ActOnManualAttendanceCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly action: ManualAction,
    /** The version the client loaded; a mismatch means someone else changed it. */
    readonly version: number,
    readonly remarks?: string,
    readonly times?: Partial<ManualEntryTimes>,
  ) {
    super();
  }
}

export class ListManualAttendanceQuery extends Query<Page<ManualAttendanceView>> {
  constructor(
    readonly actor: Actor,
    readonly filter: ManualAttendanceFilter,
  ) {
    super();
  }
}

export class GetManualAttendanceQuery extends Query<ManualAttendanceView> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}

export interface ManualContextView {
  readonly errors: string[];
  readonly warnings: string[];
  /** What the day would show if an entry with these times were approved. */
  readonly preview: AttendanceStatus | null;
}

export class GetManualAttendanceContextQuery extends Query<ManualContextView> {
  constructor(
    readonly actor: Actor,
    readonly staffId: string,
    readonly date: string,
    readonly times: { inTime: string | null; outTime: string | null },
    readonly excludeId?: string,
  ) {
    super();
  }
}
