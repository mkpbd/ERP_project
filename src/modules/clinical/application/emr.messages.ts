import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { BirthDetails, DeathDetails, NoteKind } from '../domain/emr.js';
import type { BirthRecordRow, DeathRecordRow } from '../domain/repositories.js';

/** Seeing admitted patients' notes, handovers and death and birth records. */
export const EMR_READ = 'emr:read';
/** Doctors and nurses writing notes on admitted patients, handing over and taking over. */
export const EMR_WRITE = 'emr:write';
/** Recording (and voiding) deaths and births. */
export const EMR_CERTIFY = 'emr:certify';

export interface NoteRow {
  readonly id: string;
  readonly admissionId: string;
  readonly kind: NoteKind;
  readonly doctorId: string | null;
  readonly notedAt: Date;
  readonly note: string;
  readonly handedTo: string | null;
  readonly acknowledgedAt: Date | null;
  readonly writtenBy: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NoteView extends NoteRow {
  readonly doctorName: string | null;
  readonly handedToName: string | null;
  readonly writerName: string;
}

export interface HandoverView extends NoteView {
  readonly admissionNumber: string;
  readonly patientName: string;
}

export interface RecordsOfAdmission {
  readonly death: DeathRecordRow | null;
  readonly births: BirthRecordRow[];
}

export abstract class EmrReadRepository {
  /** The admission's notes, oldest first. */
  abstract notes(admissionId: string, kind?: NoteKind): Promise<NoteRow[]>;
  /** Handovers to the user not acknowledged yet, oldest first. */
  abstract pendingHandovers(userId: string): Promise<NoteRow[]>;
  abstract death(id: string): Promise<DeathRecordRow | null>;
  abstract birth(id: string): Promise<BirthRecordRow | null>;
  /** The death record in force and the births, voided ones too. */
  abstract records(admissionId: string): Promise<RecordsOfAdmission>;
}

export interface NoteInput {
  readonly kind: NoteKind;
  readonly note: string;
  /** A round or consultation names the doctor (the writer's own when they are one). */
  readonly doctorId: string | null;
  /** Now when not given. */
  readonly notedAt: Date | null;
  /** A handover names the user taking over. */
  readonly handedTo: string | null;
}

export class WriteNoteCommand extends Command<{ id: string }> {
  constructor(
    readonly actor: Actor,
    readonly admissionId: string,
    readonly input: NoteInput,
  ) {
    super();
  }
}

export class CorrectNoteCommand extends Command<{ version: number }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly note: string,
  ) {
    super();
  }
}

export class AcknowledgeHandoverCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}

export class RecordDeathCommand extends Command<{ id: string; number: string }> {
  constructor(
    readonly actor: Actor,
    readonly admissionId: string,
    readonly doctorId: string,
    readonly details: DeathDetails,
  ) {
    super();
  }
}

export class RecordBirthCommand extends Command<{ id: string; number: string }> {
  constructor(
    readonly actor: Actor,
    readonly admissionId: string,
    readonly doctorId: string,
    readonly details: BirthDetails,
  ) {
    super();
  }
}

export class VoidRecordCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly kind: 'death' | 'birth',
    readonly id: string,
    readonly version: number,
    readonly reason: string,
  ) {
    super();
  }
}

export class ListNotesQuery extends Query<NoteView[]> {
  constructor(
    readonly actor: Actor,
    readonly admissionId: string,
    readonly kind?: NoteKind,
  ) {
    super();
  }
}

export class PendingHandoversQuery extends Query<HandoverView[]> {
  constructor(readonly actor: Actor) {
    super();
  }
}

export class GetRecordsQuery extends Query<RecordsOfAdmission> {
  constructor(
    readonly actor: Actor,
    readonly admissionId: string,
  ) {
    super();
  }
}

/** Kept through the shared record stores (note templates: rx:read / rx:manage). */
export const CLINICAL_RECORDS = { noteTemplate: 'clinical_note_template' } as const;
