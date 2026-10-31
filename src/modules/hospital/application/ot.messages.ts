import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page, PageRequest } from '../../../shared/application/pagination.js';
import type { OtCaseStatus, OtNote, OtTeamRole } from '../domain/ot-case.js';

/** Seeing the operation theatre: its board, operations and their notes. */
export const OT_READ = 'ot:read';
/** Asking for an operation for an admitted patient and changing who operates and what, before it is done. */
export const OT_REQUEST = 'ot:request';
/** Giving operations a room and a time, starting and finishing them, cancelling them. */
export const OT_SCHEDULE = 'ot:schedule';
/** Writing the operation note (signed by the surgeon). */
export const OT_NOTE = 'ot:note';
/** OT rooms, operations, OT and anaesthesia types, surgery procedures. */
export const OT_MANAGE = 'ot:manage';

export interface OtClinicalInput {
  readonly operationId: string;
  readonly otTypeId: string | null;
  readonly anaesthesiaTypeId: string | null;
  readonly surgeonId: string;
  readonly anaesthetistId: string | null;
  readonly indication: string | null;
  readonly team: readonly { readonly doctorId: string; readonly role: OtTeamRole }[];
}

export interface OtCaseFilter extends PageRequest {
  readonly status?: OtCaseStatus | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly roomId?: string | undefined;
  readonly surgeonId?: string | undefined;
  readonly admissionId?: string | undefined;
}

export interface OtCaseSummary {
  readonly id: string;
  readonly number: string;
  readonly status: OtCaseStatus;
  readonly admissionId: string;
  readonly admissionNumber: string;
  readonly patientId: string;
  readonly uhid: number;
  readonly patientName: string;
  readonly operationName: string;
  readonly surgeonName: string;
  readonly requestedFor: string;
  readonly otRoomId: string | null;
  readonly otRoomName: string | null;
  readonly scheduledFrom: Date | null;
  readonly scheduledTo: Date | null;
}

export interface OtCaseView extends OtCaseSummary, OtNote {
  readonly operationId: string;
  readonly otTypeId: string | null;
  readonly otTypeName: string | null;
  readonly anaesthesiaTypeId: string | null;
  readonly anaesthesiaTypeName: string | null;
  readonly surgeonId: string;
  readonly anaesthetistId: string | null;
  readonly anaesthetistName: string | null;
  readonly indication: string | null;
  readonly team: { readonly doctorId: string; readonly doctorName: string; readonly role: OtTeamRole }[];
  readonly startedAt: Date | null;
  readonly endedAt: Date | null;
  readonly cancelReason: string | null;
  readonly noteSignedAt: Date | null;
  readonly noteSignedByName: string | null;
  /** The stay's charges for the operation. */
  readonly charges: {
    readonly id: string;
    readonly serviceName: string;
    readonly doctorName: string | null;
    readonly qty: number;
    readonly rate: number;
    readonly amount: number;
    readonly status: 'active' | 'cancelled';
  }[];
  readonly chargedTotal: number;
  readonly version: number;
}

export interface OtBoard {
  readonly day: string;
  readonly rooms: {
    readonly id: string;
    readonly name: string;
    readonly floor: string | null;
    readonly cases: OtCaseSummary[];
  }[];
  /** Asked for on or before the day and not given a room yet. */
  readonly waiting: OtCaseSummary[];
}

export abstract class OtReadRepository {
  abstract list(filter: OtCaseFilter): Promise<Page<OtCaseSummary>>;
  abstract get(id: string): Promise<OtCaseView | null>;
  /** Active rooms with what is booked in them between the instants, and requests waiting on the day. */
  abstract board(day: string, from: Date, to: Date): Promise<OtBoard>;
  /** The user account of each doctor (null when none). */
  abstract doctorUsers(ids: readonly string[]): Promise<Map<string, string | null>>;
}

export class RequestOtCommand extends Command<{ id: string; number: string }> {
  constructor(
    readonly actor: Actor,
    readonly admissionId: string,
    readonly requestedFor: string,
    readonly input: OtClinicalInput,
  ) {
    super();
  }
}

export class ChangeOtCommand extends Command<{ version: number }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly input: OtClinicalInput,
  ) {
    super();
  }
}

export class ScheduleOtCommand extends Command<{ version: number }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly roomId: string,
    readonly from: Date,
    readonly to: Date,
  ) {
    super();
  }
}

export class MoveOtCommand extends Command<{ version: number }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly step: 'start' | 'finish',
    /** Left out: now. */
    readonly at: Date | null,
  ) {
    super();
  }
}

export class CancelOtCommand extends Command<{ version: number }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly reason: string,
  ) {
    super();
  }
}

export class WriteOtNoteCommand extends Command<{ version: number }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly note: OtNote,
  ) {
    super();
  }
}

export class SignOtNoteCommand extends Command<{ version: number }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
  ) {
    super();
  }
}

export class ListOtCasesQuery extends Query<Page<OtCaseSummary>> {
  constructor(
    readonly actor: Actor,
    readonly filter: OtCaseFilter,
  ) {
    super();
  }
}

export class GetOtCaseQuery extends Query<OtCaseView> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}

export class OtBoardQuery extends Query<OtBoard> {
  constructor(
    readonly actor: Actor,
    readonly day: string,
  ) {
    super();
  }
}
