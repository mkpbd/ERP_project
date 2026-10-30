import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import {
  HistoryReadRepository,
  type HistoryEntry,
  type HistoryKind,
  type HistoryRecordView,
  type TrendPoint,
} from '../../application/history.messages.js';
import { historyRecords, historyValues } from './clinical.schema.js';

const entry = {
  id: historyRecords.id,
  kind: historyRecords.kind,
  title: historyRecords.title,
  number: historyRecords.number,
  recordedOn: historyRecords.recordedOn,
  author: historyRecords.author,
  shared: historyRecords.shared,
};

/** A plain number (12, 13.5, -0.4); results like "Positive" or "<5" are not. */
const NUMBER = '^\\s*[-+]?[0-9]+(\\.[0-9]+)?\\s*$';

@Injectable()
export class DrizzleHistoryReadRepository extends HistoryReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  list(patientId: string, kind?: HistoryKind): Promise<HistoryEntry[]> {
    return this.context.db
      .select(entry)
      .from(historyRecords)
      .where(and(eq(historyRecords.patientId, patientId), kind ? eq(historyRecords.kind, kind) : undefined))
      .orderBy(desc(historyRecords.recordedOn), asc(historyRecords.title));
  }

  shared(patientId: string): Promise<HistoryEntry[]> {
    return this.context.db
      .select(entry)
      .from(historyRecords)
      .where(and(eq(historyRecords.patientId, patientId), eq(historyRecords.shared, true)))
      .orderBy(desc(historyRecords.recordedOn));
  }

  async find(id: string): Promise<HistoryRecordView | null> {
    const [record] = await this.context.db
      .select({ ...entry, patientId: historyRecords.patientId, body: historyRecords.body })
      .from(historyRecords)
      .where(eq(historyRecords.id, id));
    if (!record) return null;
    const values = await this.context.db
      .select({
        test: historyValues.test,
        result: historyValues.result,
        unit: historyValues.unit,
        reference: historyValues.reference,
      })
      .from(historyValues)
      .where(eq(historyValues.recordId, id))
      .orderBy(asc(historyValues.position));
    return { ...record, values };
  }

  trend(patientId: string, test: string): Promise<TrendPoint[]> {
    return this.context.db
      .select({
        recordId: historyRecords.id,
        recordedOn: historyRecords.recordedOn,
        number: historyRecords.number,
        result: historyValues.result,
        value: sql<
          number | null
        >`case when ${historyValues.result} ~ ${NUMBER} then trim(${historyValues.result})::numeric end`.mapWith(
          (value: string | null) => (value === null ? null : Number(value)),
        ),
        unit: historyValues.unit,
        reference: historyValues.reference,
      })
      .from(historyValues)
      .innerJoin(historyRecords, eq(historyRecords.id, historyValues.recordId))
      .where(and(eq(historyRecords.patientId, patientId), sql`lower(${historyValues.test}) = lower(${test})`))
      .orderBy(asc(historyRecords.recordedOn), asc(historyValues.position));
  }
}
