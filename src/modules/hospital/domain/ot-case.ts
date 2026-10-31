import { ConflictError, DomainError } from '../../../shared/domain/errors.js';
import { text } from './patient.js';

export const OT_CASE_STATUSES = ['requested', 'scheduled', 'in_progress', 'done', 'cancelled'] as const;
export type OtCaseStatus = (typeof OT_CASE_STATUSES)[number];
export const OT_TEAM_ROLES = ['assistant', 'anaesthesia_assistant'] as const;
export type OtTeamRole = (typeof OT_TEAM_ROLES)[number];
/** The longest an operation may be booked for. */
export const MAX_OT_HOURS = 24;
const HOUR = 3_600_000;

export interface OtTeamMember {
  readonly doctorId: string;
  readonly role: OtTeamRole;
}

export interface OtClinical {
  readonly operationId: string;
  readonly otTypeId: string | null;
  readonly anaesthesiaTypeId: string | null;
  readonly surgeonId: string;
  readonly anaesthetistId: string | null;
  readonly indication: string | null;
  readonly team: readonly OtTeamMember[];
}

export interface OtNote {
  readonly incision: string | null;
  readonly findings: string | null;
  readonly procedureDone: string | null;
  readonly specimen: string | null;
  readonly postOpOrders: string | null;
}

export interface OtCaseProps extends OtClinical, OtNote {
  id: string;
  number: string;
  admissionId: string;
  patientId: string;
  requestedFor: string;
  status: OtCaseStatus;
  otRoomId: string | null;
  scheduledFrom: Date | null;
  scheduledTo: Date | null;
  startedAt: Date | null;
  endedAt: Date | null;
  cancelReason: string | null;
  noteSignedAt: Date | null;
  noteSignedBy: string | null;
  requestedBy: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Note text kept with its lines (an operation note is written out), trimmed, at most `max` characters. */
function written(value: string | null | undefined, max: number, what: string): string | null {
  const kept = (value ?? '').replace(/\r\n?/g, '\n').trim();
  if (kept === '') return null;
  if (kept.length > max) throw new DomainError('invalid_text', `The ${what} is longer than ${max} characters`);
  return kept;
}

function validTeam(clinical: OtClinical): OtTeamMember[] {
  const seen = new Set<string>([clinical.surgeonId, ...(clinical.anaesthetistId ? [clinical.anaesthetistId] : [])]);
  if (clinical.anaesthetistId === clinical.surgeonId) {
    throw new DomainError('invalid_team', 'The anaesthetist is not the surgeon');
  }
  if (clinical.team.length > 10) throw new DomainError('invalid_team', 'At most ten others in the team');
  return clinical.team.map((member) => {
    if (seen.has(member.doctorId)) throw new DomainError('invalid_team', 'A doctor is named once in the team');
    seen.add(member.doctorId);
    return { doctorId: member.doctorId, role: member.role };
  });
}

/**
 * Old OTSchedules, OTRoomBookingRequests, OTRoomBooks, the OTServices header and OTNotes (six tables nothing linked,
 * a free-text status, no check that a room was free): one operation of an admitted patient. Requested by a doctor,
 * given a room and a time that no other operation in the room has, started and done, or cancelled with a reason;
 * the surgeon's operation note is written while it is under way or done and signed once done.
 */
export class OtCase {
  private constructor(private readonly props: OtCaseProps) {}

  static request(
    params: OtClinical & {
      id: string;
      number: string;
      admissionId: string;
      patientId: string;
      requestedFor: string;
      by: string;
      at: Date;
    },
  ): OtCase {
    const team = validTeam(params);
    return new OtCase({
      id: params.id,
      number: params.number,
      admissionId: params.admissionId,
      patientId: params.patientId,
      operationId: params.operationId,
      otTypeId: params.otTypeId,
      anaesthesiaTypeId: params.anaesthesiaTypeId,
      surgeonId: params.surgeonId,
      anaesthetistId: params.anaesthetistId,
      indication: text(params.indication, 500, 'indication'),
      team,
      requestedFor: params.requestedFor,
      status: 'requested',
      otRoomId: null,
      scheduledFrom: null,
      scheduledTo: null,
      startedAt: null,
      endedAt: null,
      cancelReason: null,
      incision: null,
      findings: null,
      procedureDone: null,
      specimen: null,
      postOpOrders: null,
      noteSignedAt: null,
      noteSignedBy: null,
      requestedBy: params.by,
      version: 1,
      createdAt: params.at,
      updatedAt: params.at,
    });
  }

  static restore(props: OtCaseProps): OtCase {
    return new OtCase({ ...props, team: [...props.team] });
  }

  get id(): string {
    return this.props.id;
  }

  toSnapshot(): Readonly<OtCaseProps> {
    return { ...this.props, team: [...this.props.team] };
  }

  assertVersion(version: number): void {
    if (version !== this.props.version) {
      throw new ConflictError('stale_ot_case', 'The operation was changed by someone else; reload it');
    }
  }

  private open(what: string): void {
    if (this.props.status === 'done' || this.props.status === 'cancelled') {
      throw new DomainError('ot_closed', `The operation is ${this.props.status}: it cannot be ${what}`);
    }
  }

  private touch(at: Date): void {
    this.props.version += 1;
    this.props.updatedAt = at;
  }

  /** Who operates and what, before it is done. */
  change(clinical: OtClinical, at: Date): void {
    this.open('changed');
    Object.assign(this.props, {
      team: validTeam(clinical),
      operationId: clinical.operationId,
      otTypeId: clinical.otTypeId,
      anaesthesiaTypeId: clinical.anaesthesiaTypeId,
      surgeonId: clinical.surgeonId,
      anaesthetistId: clinical.anaesthetistId,
      indication: text(clinical.indication, 500, 'indication'),
    });
    this.touch(at);
  }

  /**
   * A room and a time (a new one when it was scheduled already), not ended before now. Whether the room is free then
   * is the caller's to check, under a lock on the room.
   */
  schedule(roomId: string, from: Date, to: Date, now: Date): void {
    if (this.props.status !== 'requested' && this.props.status !== 'scheduled') {
      throw new DomainError('ot_not_schedulable', `The operation is ${this.props.status.replace('_', ' ')}`);
    }
    if (to.getTime() <= from.getTime()) throw new DomainError('invalid_slot', 'The end is after the start');
    if (to.getTime() - from.getTime() > MAX_OT_HOURS * HOUR) {
      throw new DomainError('invalid_slot', `An operation is booked for at most ${MAX_OT_HOURS} hours`);
    }
    if (to.getTime() <= now.getTime()) throw new DomainError('invalid_slot', 'The time has passed');
    Object.assign(this.props, { status: 'scheduled', otRoomId: roomId, scheduledFrom: from, scheduledTo: to });
    this.touch(now);
  }

  start(at: Date, now: Date): void {
    if (this.props.status !== 'scheduled') {
      throw new DomainError('ot_not_scheduled', 'Only a scheduled operation is started');
    }
    if (at.getTime() > now.getTime() + 5 * 60_000) throw new DomainError('invalid_time', 'The start is not ahead');
    Object.assign(this.props, { status: 'in_progress', startedAt: at });
    this.touch(now);
  }

  finish(at: Date, now: Date): void {
    if (this.props.status !== 'in_progress') {
      throw new DomainError('ot_not_started', 'Only an operation under way is done');
    }
    if (at.getTime() > now.getTime() + 5 * 60_000) throw new DomainError('invalid_time', 'The end is not ahead');
    if (at.getTime() < this.props.startedAt!.getTime()) {
      throw new DomainError('invalid_time', 'The end is after the start');
    }
    Object.assign(this.props, { status: 'done', endedAt: at });
    this.touch(now);
  }

  cancel(reason: string, at: Date): void {
    this.open('cancelled');
    if (this.props.status === 'in_progress') {
      throw new DomainError('ot_under_way', 'An operation under way is finished, not cancelled');
    }
    const why = text(reason, 300, 'reason');
    if (!why) throw new DomainError('invalid_remarks', 'Give a reason');
    Object.assign(this.props, { status: 'cancelled', cancelReason: why });
    this.touch(at);
  }

  /** The operation note, while it is under way or done and not signed. */
  writeNote(note: OtNote, at: Date): void {
    if (this.props.status !== 'in_progress' && this.props.status !== 'done') {
      throw new DomainError('ot_not_started', 'The operation note is written once the operation has started');
    }
    if (this.props.noteSignedAt) throw new DomainError('note_signed', 'The operation note is signed');
    Object.assign(this.props, {
      incision: written(note.incision, 500, 'incision'),
      findings: written(note.findings, 8000, 'findings'),
      procedureDone: written(note.procedureDone, 8000, 'procedure'),
      specimen: written(note.specimen, 1000, 'specimen'),
      postOpOrders: written(note.postOpOrders, 4000, 'post-operative orders'),
    });
    this.touch(at);
  }

  /** Signed by the surgeon once the operation is done and the procedure is written. */
  signNote(by: string, at: Date): void {
    if (this.props.status !== 'done') throw new DomainError('ot_not_done', 'The note is signed once it is done');
    if (this.props.noteSignedAt) throw new DomainError('note_signed', 'The operation note is signed');
    if (!this.props.procedureDone) throw new DomainError('note_incomplete', 'Write the procedure first');
    Object.assign(this.props, { noteSignedAt: at, noteSignedBy: by });
    this.touch(at);
  }
}
