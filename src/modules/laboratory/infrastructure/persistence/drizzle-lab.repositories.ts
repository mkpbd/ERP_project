import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { offsetOf, toPage, type Page } from '../../../../shared/application/pagination.js';
import {
  LabReadRepository,
  type ResultFilter,
  type ResultRecord,
  type ResultSummary,
  type SampleFilter,
  type SampleSummary,
} from '../../application/lab.messages.js';
import { LabResult, LabSample, type Parameter, type ResultValue } from '../../domain/lab.js';
import { LabRepository } from '../../domain/repositories.js';
import {
  labParameterRanges,
  labParameters,
  labResults,
  labResultValues,
  labSamples,
  labSequences,
} from './laboratory.schema.js';

const valueColumns = {
  parameterId: labResultValues.parameterId,
  name: labResultValues.name,
  unit: labResultValues.unit,
  method: labResultValues.method,
  value: labResultValues.value,
  numeric: labResultValues.numeric,
  low: labResultValues.low,
  high: labResultValues.high,
  normalText: labResultValues.normalText,
  flag: labResultValues.flag,
};

async function valuesOf(context: DbContext, resultIds: readonly string[]): Promise<Map<string, ResultValue[]>> {
  const map = new Map<string, ResultValue[]>();
  if (resultIds.length === 0) return map;
  const rows = await context.db
    .select({ resultId: labResultValues.resultId, ...valueColumns })
    .from(labResultValues)
    .where(inArray(labResultValues.resultId, [...resultIds]))
    .orderBy(asc(labResultValues.resultId), asc(labResultValues.position));
  for (const { resultId, ...value } of rows) map.set(resultId, [...(map.get(resultId) ?? []), value]);
  return map;
}

@Injectable()
export class DrizzleLabRepository extends LabRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async parameters(testId: string): Promise<Parameter[]> {
    const rows = await this.context.db
      .select({
        id: labParameters.id,
        name: labParameters.name,
        unit: labParameters.unit,
        method: labParameters.method,
        kind: labParameters.kind,
        decimals: labParameters.decimals,
      })
      .from(labParameters)
      .where(eq(labParameters.testId, testId))
      .orderBy(asc(labParameters.position));
    if (rows.length === 0) return [];
    const ranges = await this.context.db
      .select({
        parameterId: labParameterRanges.parameterId,
        sex: labParameterRanges.sex,
        minAgeDays: labParameterRanges.minAgeDays,
        maxAgeDays: labParameterRanges.maxAgeDays,
        low: labParameterRanges.low,
        high: labParameterRanges.high,
        normalText: labParameterRanges.normalText,
      })
      .from(labParameterRanges)
      .where(
        inArray(
          labParameterRanges.parameterId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(asc(labParameterRanges.minAgeDays));
    return rows.map((row) => ({
      ...row,
      ranges: ranges.filter((range) => range.parameterId === row.id).map(({ parameterId: _p, ...range }) => range),
    }));
  }

  async setParameters(testId: string, parameters: readonly Omit<Parameter, 'id'>[]): Promise<void> {
    await this.context.db.delete(labParameters).where(eq(labParameters.testId, testId));
    for (const [index, { ranges, ...parameter }] of parameters.entries()) {
      const id = randomUUID();
      await this.context.db.insert(labParameters).values({ ...parameter, id, testId, position: index + 1 });
      if (ranges.length > 0) {
        await this.context.db
          .insert(labParameterRanges)
          .values(ranges.map((range) => ({ ...range, id: randomUUID(), parameterId: id })));
      }
    }
  }

  async nextSerial(day: string): Promise<number> {
    const [row] = await this.context.db
      .insert(labSequences)
      .values({ day, last: 1 })
      .onConflictDoUpdate({ target: labSequences.day, set: { last: sql`${labSequences.last} + 1` } })
      .returning({ last: labSequences.last });
    return row!.last;
  }

  async linesInWork(billId: string): Promise<Set<number>> {
    const rows = await this.context.db
      .select({ line: labResults.line })
      .from(labResults)
      .where(and(eq(labResults.billId, billId), ne(labResults.status, 'rejected')));
    return new Set(rows.map((row) => row.line));
  }

  async insertSample(sample: LabSample, results: readonly LabResult[]): Promise<void> {
    await this.context.db.insert(labSamples).values(sample.toSnapshot());
    for (const result of results) {
      const { values: _values, ...row } = result.toSnapshot();
      await this.context.db.insert(labResults).values(row);
    }
  }

  async sampleForUpdate(id: string): Promise<LabSample | null> {
    const [row] = await this.context.db.select().from(labSamples).where(eq(labSamples.id, id)).for('update');
    return row ? LabSample.restore(row) : null;
  }

  async updateSample(sample: LabSample): Promise<void> {
    const { id, ...row } = sample.toSnapshot();
    await this.context.db.update(labSamples).set(row).where(eq(labSamples.id, id));
  }

  async resultsOf(sampleId: string): Promise<LabResult[]> {
    const rows = await this.context.db
      .select()
      .from(labResults)
      .where(eq(labResults.sampleId, sampleId))
      .orderBy(asc(labResults.line))
      .for('update');
    const values = await valuesOf(
      this.context,
      rows.map((row) => row.id),
    );
    return rows.map((row) => LabResult.restore({ ...row, values: values.get(row.id) ?? [] }));
  }

  async resultForUpdate(id: string): Promise<LabResult | null> {
    const [row] = await this.context.db.select().from(labResults).where(eq(labResults.id, id)).for('update');
    if (!row) return null;
    const values = await valuesOf(this.context, [id]);
    return LabResult.restore({ ...row, values: values.get(id) ?? [] });
  }

  async updateResult(result: LabResult): Promise<void> {
    const { id, values, ...row } = result.toSnapshot();
    await this.context.db.update(labResults).set(row).where(eq(labResults.id, id));
    await this.context.db.delete(labResultValues).where(eq(labResultValues.resultId, id));
    if (values.length > 0) {
      await this.context.db
        .insert(labResultValues)
        .values(values.map((value, index) => ({ ...value, resultId: id, position: index + 1 })));
    }
  }
}

@Injectable()
export class DrizzleLabReadRepository extends LabReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  private sampleSummaries() {
    return this.context.db
      .select({
        id: labSamples.id,
        labNumber: labSamples.labNumber,
        billId: labSamples.billId,
        departmentId: labSamples.departmentId,
        patientId: labSamples.patientId,
        collectedOn: labSamples.collectedOn,
        collectedAt: labSamples.collectedAt,
        status: labSamples.status,
        tests:
          sql<number>`(select count(*) from ${labResults} where ${labResults.sampleId} = ${labSamples.id} and ${labResults.status} <> 'rejected')`.mapWith(
            Number,
          ),
        verified:
          sql<number>`(select count(*) from ${labResults} where ${labResults.sampleId} = ${labSamples.id} and ${labResults.status} in ('verified', 'delivered'))`.mapWith(
            Number,
          ),
        version: labSamples.version,
      })
      .from(labSamples);
  }

  async samples(filter: SampleFilter): Promise<Page<SampleSummary>> {
    const where = and(
      filter.status ? eq(labSamples.status, filter.status) : undefined,
      filter.departmentId ? eq(labSamples.departmentId, filter.departmentId) : undefined,
      filter.billId ? eq(labSamples.billId, filter.billId) : undefined,
      filter.from ? gte(labSamples.collectedOn, filter.from) : undefined,
      filter.to ? lte(labSamples.collectedOn, filter.to) : undefined,
    );
    const rows = await this.sampleSummaries()
      .where(where)
      .orderBy(desc(labSamples.collectedAt))
      .limit(filter.pageSize)
      .offset(offsetOf(filter));
    const [total] = await this.context.db.select({ n: count() }).from(labSamples).where(where);
    return toPage(rows, total?.n ?? 0, filter);
  }

  async sample(id: string) {
    const [summary] = await this.sampleSummaries().where(eq(labSamples.id, id));
    if (!summary) return null;
    const [extra] = await this.context.db
      .select({ rejectReason: labSamples.rejectReason })
      .from(labSamples)
      .where(eq(labSamples.id, id));
    const results = await this.records(eq(labResults.sampleId, id));
    return { ...summary, rejectReason: extra?.rejectReason ?? null, results };
  }

  private resultSummaries() {
    return this.context.db
      .select({
        id: labResults.id,
        sampleId: labResults.sampleId,
        labNumber: labSamples.labNumber,
        billId: labResults.billId,
        line: labResults.line,
        testId: labResults.testId,
        status: labResults.status,
        collectedAt: labSamples.collectedAt,
        version: labResults.version,
      })
      .from(labResults)
      .innerJoin(labSamples, eq(labSamples.id, labResults.sampleId));
  }

  async results(filter: ResultFilter): Promise<Page<ResultSummary>> {
    const where = and(
      filter.status ? eq(labResults.status, filter.status) : undefined,
      filter.sampleId ? eq(labResults.sampleId, filter.sampleId) : undefined,
      filter.from ? gte(labSamples.collectedOn, filter.from) : undefined,
      filter.to ? lte(labSamples.collectedOn, filter.to) : undefined,
    );
    const rows = await this.resultSummaries()
      .where(where)
      .orderBy(asc(labSamples.collectedAt), asc(labResults.line))
      .limit(filter.pageSize)
      .offset(offsetOf(filter));
    const [total] = await this.context.db
      .select({ n: count() })
      .from(labResults)
      .innerJoin(labSamples, eq(labSamples.id, labResults.sampleId))
      .where(where);
    return toPage(rows, total?.n ?? 0, filter);
  }

  private async records(where: ReturnType<typeof eq>): Promise<ResultRecord[]> {
    const rows = await this.context.db
      .select({
        id: labResults.id,
        sampleId: labResults.sampleId,
        labNumber: labSamples.labNumber,
        billId: labResults.billId,
        line: labResults.line,
        testId: labResults.testId,
        status: labResults.status,
        collectedAt: labSamples.collectedAt,
        version: labResults.version,
        comment: labResults.comment,
        enteredBy: labResults.enteredBy,
        enteredAt: labResults.enteredAt,
        verifiedBy: labResults.verifiedBy,
        verifiedAt: labResults.verifiedAt,
        deliveredTo: labResults.deliveredTo,
        deliveredAt: labResults.deliveredAt,
      })
      .from(labResults)
      .innerJoin(labSamples, eq(labSamples.id, labResults.sampleId))
      .where(where)
      .orderBy(asc(labResults.line));
    const values = await valuesOf(
      this.context,
      rows.map((row) => row.id),
    );
    return rows.map((row) => ({ ...row, values: values.get(row.id) ?? [] }));
  }

  async result(id: string): Promise<ResultRecord | null> {
    const [row] = await this.records(eq(labResults.id, id));
    return row ?? null;
  }
}
