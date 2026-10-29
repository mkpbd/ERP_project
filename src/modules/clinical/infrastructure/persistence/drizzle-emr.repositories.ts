import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { EmrReadRepository, type NoteRow, type RecordsOfAdmission } from '../../application/emr.messages.js';
import { ClinicalNote, type NoteKind } from '../../domain/emr.js';
import { EmrRepository, type BirthRecordRow, type DeathRecordRow } from '../../domain/repositories.js';
import { birthRecords, clinicalNotes, deathRecords } from './clinical.schema.js';

const noteColumns = {
  id: clinicalNotes.id,
  admissionId: clinicalNotes.admissionId,
  kind: clinicalNotes.kind,
  doctorId: clinicalNotes.doctorId,
  notedAt: clinicalNotes.notedAt,
  note: clinicalNotes.note,
  handedTo: clinicalNotes.handedTo,
  acknowledgedAt: clinicalNotes.acknowledgedAt,
  writtenBy: clinicalNotes.writtenBy,
  version: clinicalNotes.version,
  createdAt: clinicalNotes.createdAt,
  updatedAt: clinicalNotes.updatedAt,
};

function deathRow(row: typeof deathRecords.$inferSelect): DeathRecordRow {
  const { updatedAt: _updated, ...rest } = row;
  return rest;
}

function birthRow(row: typeof birthRecords.$inferSelect): BirthRecordRow {
  const { updatedAt: _updated, ...rest } = row;
  return rest;
}

@Injectable()
export class DrizzleEmrRepository extends EmrRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async insertNote(note: ClinicalNote): Promise<void> {
    await this.context.db.insert(clinicalNotes).values(note.toSnapshot());
  }

  async noteForUpdate(id: string): Promise<ClinicalNote | null> {
    const [row] = await this.context.db.select().from(clinicalNotes).where(eq(clinicalNotes.id, id)).for('update');
    return row ? ClinicalNote.restore(row) : null;
  }

  async updateNote(note: ClinicalNote): Promise<void> {
    const { id, note: text, acknowledgedAt, version, updatedAt } = note.toSnapshot();
    await this.context.db
      .update(clinicalNotes)
      .set({ note: text, acknowledgedAt, version, updatedAt })
      .where(eq(clinicalNotes.id, id));
  }

  async liveDeath(admissionId: string): Promise<{ id: string; number: string } | null> {
    const [row] = await this.context.db
      .select({ id: deathRecords.id, number: deathRecords.number })
      .from(deathRecords)
      .where(and(eq(deathRecords.admissionId, admissionId), isNull(deathRecords.voidedAt)));
    return row ?? null;
  }

  async insertDeath(record: DeathRecordRow): Promise<void> {
    await this.context.db.insert(deathRecords).values(record);
  }

  async deathForUpdate(id: string): Promise<DeathRecordRow | null> {
    const [row] = await this.context.db.select().from(deathRecords).where(eq(deathRecords.id, id)).for('update');
    return row ? deathRow(row) : null;
  }

  async insertBirth(record: BirthRecordRow): Promise<void> {
    await this.context.db.insert(birthRecords).values(record);
  }

  async birthForUpdate(id: string): Promise<BirthRecordRow | null> {
    const [row] = await this.context.db.select().from(birthRecords).where(eq(birthRecords.id, id)).for('update');
    return row ? birthRow(row) : null;
  }

  async voidRecord(kind: 'death' | 'birth', id: string, reason: string, at: Date): Promise<void> {
    const table = kind === 'death' ? deathRecords : birthRecords;
    const [row] = await this.context.db.select({ version: table.version }).from(table).where(eq(table.id, id));
    await this.context.db
      .update(table)
      .set({ voidedAt: at, voidReason: reason, version: row!.version + 1, updatedAt: at })
      .where(eq(table.id, id));
  }
}

@Injectable()
export class DrizzleEmrReadRepository extends EmrReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  notes(admissionId: string, kind?: NoteKind): Promise<NoteRow[]> {
    return this.context.db
      .select(noteColumns)
      .from(clinicalNotes)
      .where(
        kind
          ? and(eq(clinicalNotes.admissionId, admissionId), eq(clinicalNotes.kind, kind))
          : eq(clinicalNotes.admissionId, admissionId),
      )
      .orderBy(asc(clinicalNotes.notedAt), asc(clinicalNotes.createdAt));
  }

  pendingHandovers(userId: string): Promise<NoteRow[]> {
    return this.context.db
      .select(noteColumns)
      .from(clinicalNotes)
      .where(and(eq(clinicalNotes.handedTo, userId), isNull(clinicalNotes.acknowledgedAt)))
      .orderBy(asc(clinicalNotes.notedAt));
  }

  async death(id: string): Promise<DeathRecordRow | null> {
    const [row] = await this.context.db.select().from(deathRecords).where(eq(deathRecords.id, id));
    return row ? deathRow(row) : null;
  }

  async birth(id: string): Promise<BirthRecordRow | null> {
    const [row] = await this.context.db.select().from(birthRecords).where(eq(birthRecords.id, id));
    return row ? birthRow(row) : null;
  }

  async records(admissionId: string): Promise<RecordsOfAdmission> {
    const [death] = await this.context.db
      .select()
      .from(deathRecords)
      .where(and(eq(deathRecords.admissionId, admissionId), isNull(deathRecords.voidedAt)));
    const births = await this.context.db
      .select()
      .from(birthRecords)
      .where(eq(birthRecords.admissionId, admissionId))
      .orderBy(asc(birthRecords.bornAt), desc(birthRecords.createdAt));
    return { death: death ? deathRow(death) : null, births: births.map(birthRow) };
  }
}
