import { ConflictError, DomainError, ForbiddenError } from '../../../shared/domain/errors.js';
import { text } from './prescription.js';

export const NOTE_KINDS = ['round', 'consult', 'procedure', 'transfer', 'icu', 'handover'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
/** Notes a doctor's visit: they name the doctor. */
export const DOCTOR_NOTES: readonly NoteKind[] = ['round', 'consult'];
/** A note is corrected by its writer within this many hours; later, another note is written. */
export const NOTE_EDIT_HOURS = 24;
const HOUR = 3_600_000;

function required(value: string | null | undefined, max: number, what: string): string {
  const kept = text(value, max, what);
  if (!kept) throw new DomainError('invalid_text', `Give the ${what}`);
  return kept;
}

/** A moment of the stay: not ahead of now (a few minutes' slack for clocks) and not before the day admitted. */
export function assertDuringStay(at: Date, now: Date, dayOf: (at: Date) => string, admittedOn: string, what: string) {
  if (at.getTime() > now.getTime() + 5 * 60_000) throw new DomainError('invalid_time', `The ${what} is not ahead`);
  if (dayOf(at) < admittedOn) throw new DomainError('invalid_time', `The ${what} is not before the admission`);
}

export interface NoteProps {
  id: string;
  admissionId: string;
  patientId: string;
  kind: NoteKind;
  doctorId: string | null;
  notedAt: Date;
  note: string;
  handedTo: string | null;
  acknowledgedAt: Date | null;
  writtenBy: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Old EMR notes (ConsultancyVisitNote, DoctorVisitPlan, ProcedureNote, TransferNotesEMR, ICUCourse, nurse handover):
 * what was seen or done for an admitted patient. A round or consultation names the doctor; a handover names the nurse
 * taking over, who acknowledges it. Only the writer corrects a note, within a day.
 */
export class ClinicalNote {
  private constructor(private readonly props: NoteProps) {}

  static write(params: {
    id: string;
    admissionId: string;
    patientId: string;
    kind: NoteKind;
    doctorId: string | null;
    notedAt: Date;
    note: string;
    handedTo: string | null;
    by: string;
    at: Date;
  }): ClinicalNote {
    if (DOCTOR_NOTES.includes(params.kind) && !params.doctorId) {
      throw new DomainError('doctor_needed', `A ${params.kind} note names the doctor`);
    }
    if ((params.kind === 'handover') !== (params.handedTo !== null)) {
      throw new DomainError('invalid_handover', 'A handover, and only a handover, names who takes over');
    }
    if (params.handedTo === params.by) throw new DomainError('invalid_handover', 'A handover is to someone else');
    return new ClinicalNote({
      id: params.id,
      admissionId: params.admissionId,
      patientId: params.patientId,
      kind: params.kind,
      doctorId: params.doctorId,
      notedAt: params.notedAt,
      note: required(params.note, 8000, 'note'),
      handedTo: params.handedTo,
      acknowledgedAt: null,
      writtenBy: params.by,
      version: 1,
      createdAt: params.at,
      updatedAt: params.at,
    });
  }

  static restore(props: NoteProps): ClinicalNote {
    return new ClinicalNote({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get admissionId(): string {
    return this.props.admissionId;
  }

  correct(note: string, by: string, at: Date): void {
    if (by !== this.props.writtenBy) throw new ForbiddenError('not_your_note', 'Only its writer corrects a note');
    if (at.getTime() - this.props.createdAt.getTime() > NOTE_EDIT_HOURS * HOUR) {
      throw new DomainError('note_locked', `A note is corrected within ${NOTE_EDIT_HOURS} hours; write another`);
    }
    this.props.note = required(note, 8000, 'note');
    this.touch(at);
  }

  acknowledge(by: string, at: Date): void {
    if (this.props.kind !== 'handover' || this.props.handedTo !== by) {
      throw new ForbiddenError('not_your_handover', 'Only the one taking over acknowledges a handover');
    }
    if (this.props.acknowledgedAt) return;
    this.props.acknowledgedAt = at;
    this.touch(at);
  }

  assertVersion(version: number): void {
    if (version !== this.props.version) {
      throw new ConflictError('stale_note', 'The note was changed meanwhile; reload it');
    }
  }

  toSnapshot(): Readonly<NoteProps> {
    return { ...this.props };
  }

  private touch(at: Date): void {
    this.props.version += 1;
    this.props.updatedAt = at;
  }
}

export interface DeathDetails {
  diedAt: Date;
  cause: string;
  antecedentCause: string | null;
  otherConditions: string | null;
  deceasedNid: string | null;
  guardianName: string | null;
  guardianNid: string | null;
  guardianRelation: string | null;
  familyContactNo: string | null;
}

const NID = /^(\d{10}|\d{13}|\d{17})$/;
const MOBILE = /^01[3-9]\d{8}$/;

function nid(value: string | null, what: string): string | null {
  const kept = text(value, 17, what);
  if (kept && !NID.test(kept)) throw new DomainError('invalid_nid', `The ${what} is 10, 13 or 17 digits`);
  return kept;
}

/** Old DeathRecord fields: the causes as certified, the deceased's and the guardian's NIDs, the family's number. */
export function checkedDeath(details: DeathDetails): DeathDetails {
  const contact = text(details.familyContactNo, 11, 'contact number');
  if (contact && !MOBILE.test(contact)) throw new DomainError('invalid_mobile', 'The contact number is a mobile');
  return {
    diedAt: details.diedAt,
    cause: required(details.cause, 500, 'cause of death'),
    antecedentCause: text(details.antecedentCause, 500, 'antecedent cause'),
    otherConditions: text(details.otherConditions, 1000, 'other conditions'),
    deceasedNid: nid(details.deceasedNid, "deceased's NID"),
    guardianName: text(details.guardianName, 150, "guardian's name"),
    guardianNid: nid(details.guardianNid, "guardian's NID"),
    guardianRelation: text(details.guardianRelation, 50, 'relation'),
    familyContactNo: contact,
  };
}

export const DELIVERY_MODES = ['normal', 'caesarean', 'assisted'] as const;

export interface BirthDetails {
  childName: string | null;
  childSex: 'male' | 'female' | 'other';
  bornAt: Date;
  deliveryMode: (typeof DELIVERY_MODES)[number];
  birthWeightKg: number;
  fatherName: string | null;
  grandfatherName: string | null;
  religion: string | null;
  fatherPresentAddress: string | null;
  fatherPermanentAddress: string | null;
  comments: string | null;
}

/** Old BirthCertificate fields; the weight in kilograms (0.3 to 7). */
export function checkedBirth(details: BirthDetails): BirthDetails {
  if (!Number.isFinite(details.birthWeightKg) || details.birthWeightKg < 0.3 || details.birthWeightKg > 7) {
    throw new DomainError('invalid_weight', 'A birth weight is 0.3 to 7 kg');
  }
  return {
    childName: text(details.childName, 150, "child's name"),
    childSex: details.childSex,
    bornAt: details.bornAt,
    deliveryMode: details.deliveryMode,
    birthWeightKg: Math.round(details.birthWeightKg * 100) / 100,
    fatherName: text(details.fatherName, 150, "father's name"),
    grandfatherName: text(details.grandfatherName, 150, "grandfather's name"),
    religion: text(details.religion, 50, 'religion'),
    fatherPresentAddress: text(details.fatherPresentAddress, 300, 'present address'),
    fatherPermanentAddress: text(details.fatherPermanentAddress, 300, 'permanent address'),
    comments: text(details.comments, 1000, 'comments'),
  };
}

/** A certificate taken back (recorded in error); a new one may then be recorded. */
export function voidReason(reason: string): string {
  return required(reason, 300, 'reason');
}
