import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { offsetOf, toPage, type Page } from '../../../../shared/application/pagination.js';
import {
  ImagingReadRepository,
  type StudyFilter,
  type StudyRecord,
  type StudySummary,
} from '../../application/imaging.messages.js';
import { ImagingStudy, type ImagingTemplate } from '../../domain/imaging.js';
import { ImagingRepository } from '../../domain/repositories.js';
import { imagingSequences, imagingStudies, imagingTemplates } from './laboratory.schema.js';

@Injectable()
export class DrizzleImagingRepository extends ImagingRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  templates(testId: string): Promise<ImagingTemplate[]> {
    return this.context.db
      .select({
        name: imagingTemplates.name,
        findings: imagingTemplates.findings,
        impression: imagingTemplates.impression,
      })
      .from(imagingTemplates)
      .where(eq(imagingTemplates.testId, testId))
      .orderBy(asc(imagingTemplates.position));
  }

  async setTemplates(testId: string, templates: readonly ImagingTemplate[]): Promise<void> {
    await this.context.db.delete(imagingTemplates).where(eq(imagingTemplates.testId, testId));
    if (templates.length > 0) {
      await this.context.db
        .insert(imagingTemplates)
        .values(templates.map((template, index) => ({ ...template, id: randomUUID(), testId, position: index + 1 })));
    }
  }

  async nextAccession(day: string): Promise<number> {
    const [row] = await this.context.db
      .insert(imagingSequences)
      .values({ day, last: 1 })
      .onConflictDoUpdate({ target: imagingSequences.day, set: { last: sql`${imagingSequences.last} + 1` } })
      .returning({ last: imagingSequences.last });
    return row!.last;
  }

  async studyOfLine(billId: string, line: number): Promise<string | null> {
    const [row] = await this.context.db
      .select({ id: imagingStudies.id })
      .from(imagingStudies)
      .where(and(eq(imagingStudies.billId, billId), eq(imagingStudies.line, line)));
    return row?.id ?? null;
  }

  async insertStudy(study: ImagingStudy): Promise<void> {
    await this.context.db.insert(imagingStudies).values(study.toSnapshot());
  }

  async studyForUpdate(id: string): Promise<ImagingStudy | null> {
    const [row] = await this.context.db.select().from(imagingStudies).where(eq(imagingStudies.id, id)).for('update');
    return row ? ImagingStudy.restore(row) : null;
  }

  async updateStudy(study: ImagingStudy): Promise<void> {
    const { id, ...row } = study.toSnapshot();
    await this.context.db.update(imagingStudies).set(row).where(eq(imagingStudies.id, id));
  }
}

const summary = {
  id: imagingStudies.id,
  accessionNumber: imagingStudies.accessionNumber,
  billId: imagingStudies.billId,
  line: imagingStudies.line,
  testId: imagingStudies.testId,
  patientId: imagingStudies.patientId,
  doneOn: imagingStudies.doneOn,
  doneAt: imagingStudies.doneAt,
  status: imagingStudies.status,
  radiologistId: imagingStudies.radiologistId,
  version: imagingStudies.version,
};

@Injectable()
export class DrizzleImagingReadRepository extends ImagingReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async studies(filter: StudyFilter): Promise<Page<StudySummary>> {
    const where = and(
      filter.status ? eq(imagingStudies.status, filter.status) : undefined,
      filter.billId ? eq(imagingStudies.billId, filter.billId) : undefined,
      filter.radiologistId ? eq(imagingStudies.radiologistId, filter.radiologistId) : undefined,
      filter.from ? gte(imagingStudies.doneOn, filter.from) : undefined,
      filter.to ? lte(imagingStudies.doneOn, filter.to) : undefined,
    );
    const rows = await this.context.db
      .select(summary)
      .from(imagingStudies)
      .where(where)
      .orderBy(desc(imagingStudies.doneAt))
      .limit(filter.pageSize)
      .offset(offsetOf(filter));
    const [total] = await this.context.db.select({ n: count() }).from(imagingStudies).where(where);
    return toPage(rows, total?.n ?? 0, filter);
  }

  async study(id: string): Promise<StudyRecord | null> {
    const [row] = await this.context.db
      .select({
        ...summary,
        findings: imagingStudies.findings,
        impression: imagingStudies.impression,
        signedBy: imagingStudies.signedBy,
        signedAt: imagingStudies.signedAt,
        reportingFee: imagingStudies.reportingFee,
        deliveredTo: imagingStudies.deliveredTo,
        deliveredAt: imagingStudies.deliveredAt,
      })
      .from(imagingStudies)
      .where(eq(imagingStudies.id, id));
    return row ?? null;
  }
}
