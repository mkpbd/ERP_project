import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, ilike, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { offsetOf, toPage, type Page } from '../../../../shared/application/pagination.js';
import { ConflictError } from '../../../../shared/domain/errors.js';
import { escapeLike, uniqueViolationConstraint } from '../../../../shared/infrastructure/persistence/pg-errors.js';
import {
  ClinicalReadRepository,
  type PhraseFilter,
  type RxFilter,
  type RxRecord,
  type RxRow,
} from '../../application/rx.messages.js';
import { Prescription, type PrescriptionProps, type TemplateProps } from '../../domain/prescription.js';
import { ClinicalRepository, type Phrase } from '../../domain/repositories.js';
import {
  clinicalSequences,
  phrases,
  prescriptions,
  rxAdvices,
  rxComplaints,
  rxDrugs,
  rxTemplates,
  rxTests,
} from './clinical.schema.js';

const NONE = '00000000-0000-0000-0000-000000000000';

/** The prescription's columns (lines apart). */
function columns(props: PrescriptionProps) {
  const { complaints: _c, drugs: _d, tests: _t, advices: _a, ...rest } = props;
  return rest;
}

/** A prescription row with its lines, in order. */
async function load(context: DbContext, id: string, lock: boolean): Promise<PrescriptionProps | null> {
  const query = context.db.select().from(prescriptions).where(eq(prescriptions.id, id));
  const [row] = lock ? await query.for('update') : await query;
  if (!row) return null;
  const complaints = await context.db
    .select({ complaint: rxComplaints.complaint, duration: rxComplaints.duration })
    .from(rxComplaints)
    .where(eq(rxComplaints.prescriptionId, id))
    .orderBy(asc(rxComplaints.position));
  const drugs = await context.db
    .select({
      productId: rxDrugs.productId,
      name: rxDrugs.name,
      dose: rxDrugs.dose,
      duration: rxDrugs.duration,
      qty: rxDrugs.qty,
    })
    .from(rxDrugs)
    .where(eq(rxDrugs.prescriptionId, id))
    .orderBy(asc(rxDrugs.position));
  const tests = await context.db
    .select({ testId: rxTests.testId, name: rxTests.name, note: rxTests.note })
    .from(rxTests)
    .where(eq(rxTests.prescriptionId, id))
    .orderBy(asc(rxTests.position));
  const advices = await context.db
    .select({ advice: rxAdvices.advice })
    .from(rxAdvices)
    .where(eq(rxAdvices.prescriptionId, id))
    .orderBy(asc(rxAdvices.position));
  return { ...row, complaints, drugs, tests, advices: advices.map((entry) => entry.advice) };
}

@Injectable()
export class DrizzleClinicalRepository extends ClinicalRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async nextSerial(kind: string, year: number): Promise<number> {
    const [row] = await this.context.db
      .insert(clinicalSequences)
      .values({ kind, year, last: 1 })
      .onConflictDoUpdate({
        target: [clinicalSequences.kind, clinicalSequences.year],
        set: { last: sql`${clinicalSequences.last} + 1` },
      })
      .returning({ last: clinicalSequences.last });
    return row!.last;
  }

  async visitCount(patientId: string, doctorId: string): Promise<number> {
    const [row] = await this.context.db
      .select({ n: count() })
      .from(prescriptions)
      .where(
        and(
          eq(prescriptions.patientId, patientId),
          eq(prescriptions.doctorId, doctorId),
          ne(prescriptions.status, 'cancelled'),
        ),
      );
    return row?.n ?? 0;
  }

  async ofAppointment(appointmentId: string): Promise<{ id: string; number: string } | null> {
    const [row] = await this.context.db
      .select({ id: prescriptions.id, number: prescriptions.number })
      .from(prescriptions)
      .where(and(eq(prescriptions.appointmentId, appointmentId), ne(prescriptions.status, 'cancelled')));
    return row ?? null;
  }

  async insert(prescription: Prescription): Promise<void> {
    await this.context.db.insert(prescriptions).values(columns(prescription.toSnapshot()));
  }

  async forUpdate(id: string): Promise<Prescription | null> {
    const props = await load(this.context, id, true);
    return props ? Prescription.restore(props) : null;
  }

  async update(prescription: Prescription): Promise<void> {
    const props = prescription.toSnapshot();
    const { id, createdAt: _created, ...rest } = columns(props);
    await this.context.db.update(prescriptions).set(rest).where(eq(prescriptions.id, id));
    await this.context.db.delete(rxComplaints).where(eq(rxComplaints.prescriptionId, id));
    await this.context.db.delete(rxDrugs).where(eq(rxDrugs.prescriptionId, id));
    await this.context.db.delete(rxTests).where(eq(rxTests.prescriptionId, id));
    await this.context.db.delete(rxAdvices).where(eq(rxAdvices.prescriptionId, id));
    if (props.complaints.length) {
      await this.context.db
        .insert(rxComplaints)
        .values(props.complaints.map((entry, index) => ({ ...entry, prescriptionId: id, position: index + 1 })));
    }
    if (props.drugs.length) {
      await this.context.db
        .insert(rxDrugs)
        .values(props.drugs.map((drug, index) => ({ ...drug, prescriptionId: id, position: index + 1 })));
    }
    if (props.tests.length) {
      await this.context.db
        .insert(rxTests)
        .values(props.tests.map((test, index) => ({ ...test, prescriptionId: id, position: index + 1 })));
    }
    if (props.advices.length) {
      await this.context.db
        .insert(rxAdvices)
        .values(props.advices.map((advice, index) => ({ advice, prescriptionId: id, position: index + 1 })));
    }
  }

  async phrase(id: string): Promise<Phrase | null> {
    const [row] = await this.context.db
      .select({
        id: phrases.id,
        doctorId: phrases.doctorId,
        kind: phrases.kind,
        text: phrases.text,
        shortKey: phrases.shortKey,
        genericId: phrases.genericId,
      })
      .from(phrases)
      .where(eq(phrases.id, id));
    return row ?? null;
  }

  private async unique<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      const constraint = uniqueViolationConstraint(error);
      if (constraint === 'clinical_phrases_text_uq') throw new ConflictError('phrase_exists', 'This phrase is listed');
      if (constraint === 'clinical_rx_templates_name_uq') {
        throw new ConflictError('template_name_taken', 'You have a template of this name');
      }
      throw error;
    }
  }

  async insertPhrase(phrase: Phrase): Promise<void> {
    await this.unique(() => this.context.db.insert(phrases).values(phrase));
  }

  async updatePhrase(phrase: Phrase): Promise<void> {
    await this.unique(() =>
      this.context.db
        .update(phrases)
        .set({ text: phrase.text, shortKey: phrase.shortKey, updatedAt: new Date() })
        .where(eq(phrases.id, phrase.id)),
    );
  }

  async deletePhrase(id: string): Promise<void> {
    await this.context.db.delete(phrases).where(eq(phrases.id, id));
  }

  async template(id: string): Promise<TemplateProps | null> {
    const [row] = await this.context.db
      .select({
        id: rxTemplates.id,
        doctorId: rxTemplates.doctorId,
        name: rxTemplates.name,
        diagnosis: rxTemplates.diagnosis,
        drugs: rxTemplates.drugs,
        tests: rxTemplates.tests,
        advices: rxTemplates.advices,
        version: rxTemplates.version,
      })
      .from(rxTemplates)
      .where(eq(rxTemplates.id, id));
    return row ?? null;
  }

  async insertTemplate(template: TemplateProps): Promise<void> {
    await this.unique(() => this.context.db.insert(rxTemplates).values(template));
  }

  async updateTemplate(template: TemplateProps): Promise<void> {
    const { id, doctorId: _doctor, ...rest } = template;
    await this.unique(() =>
      this.context.db
        .update(rxTemplates)
        .set({ ...rest, updatedAt: new Date() })
        .where(eq(rxTemplates.id, id)),
    );
  }

  async deleteTemplate(id: string): Promise<void> {
    await this.context.db.delete(rxTemplates).where(eq(rxTemplates.id, id));
  }
}

@Injectable()
export class DrizzleClinicalReadRepository extends ClinicalReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async prescriptions(filter: RxFilter): Promise<Page<RxRow>> {
    const conditions: SQL[] = [];
    if (filter.doctorId) conditions.push(eq(prescriptions.doctorId, filter.doctorId));
    if (filter.patientId) conditions.push(eq(prescriptions.patientId, filter.patientId));
    if (filter.status) conditions.push(eq(prescriptions.status, filter.status));
    if (filter.from) conditions.push(gte(prescriptions.visitOn, filter.from));
    if (filter.to) conditions.push(lte(prescriptions.visitOn, filter.to));
    if (filter.number) conditions.push(sql`upper(${prescriptions.number}) = upper(${filter.number})`);
    const where = conditions.length ? and(...conditions) : undefined;
    const [total] = await this.context.db.select({ n: count() }).from(prescriptions).where(where);
    const items = await this.context.db
      .select({
        id: prescriptions.id,
        number: prescriptions.number,
        patientId: prescriptions.patientId,
        doctorId: prescriptions.doctorId,
        appointmentId: prescriptions.appointmentId,
        visitNo: prescriptions.visitNo,
        visitOn: prescriptions.visitOn,
        status: prescriptions.status,
        diagnosis: prescriptions.diagnosis,
        signedAt: prescriptions.signedAt,
      })
      .from(prescriptions)
      .where(where)
      .orderBy(desc(prescriptions.visitOn), desc(prescriptions.createdAt))
      .limit(filter.pageSize)
      .offset(offsetOf(filter));
    return toPage(items, total?.n ?? 0, filter);
  }

  async prescription(id: string): Promise<RxRecord | null> {
    const props = await load(this.context, id, false);
    if (!props) return null;
    const { createdAt: _created, ...rest } = props;
    return rest;
  }

  phrases(doctorId: string | null, filter: PhraseFilter): Promise<Phrase[]> {
    const conditions: (SQL | undefined)[] = [
      doctorId ? or(isNull(phrases.doctorId), eq(phrases.doctorId, doctorId)) : isNull(phrases.doctorId),
    ];
    if (filter.kind) conditions.push(eq(phrases.kind, filter.kind));
    if (filter.genericId) conditions.push(or(isNull(phrases.genericId), eq(phrases.genericId, filter.genericId)));
    if (filter.q) {
      const like = `%${escapeLike(filter.q)}%`;
      conditions.push(or(ilike(phrases.text, like), ilike(phrases.shortKey, like)));
    }
    return this.context.db
      .select({
        id: phrases.id,
        doctorId: phrases.doctorId,
        kind: phrases.kind,
        text: phrases.text,
        shortKey: phrases.shortKey,
        genericId: phrases.genericId,
      })
      .from(phrases)
      .where(and(...conditions))
      .orderBy(
        // The doctor's own first, then a generic's doses before the general ones.
        sql`coalesce(${phrases.doctorId}, ${NONE}::uuid) = ${NONE}::uuid`,
        sql`${phrases.genericId} is null`,
        asc(phrases.kind),
        asc(phrases.text),
      )
      .limit(500);
  }

  templates(doctorId: string): Promise<{ id: string; name: string; diagnosis: string | null }[]> {
    return this.context.db
      .select({ id: rxTemplates.id, name: rxTemplates.name, diagnosis: rxTemplates.diagnosis })
      .from(rxTemplates)
      .where(eq(rxTemplates.doctorId, doctorId))
      .orderBy(asc(rxTemplates.name));
  }
}
