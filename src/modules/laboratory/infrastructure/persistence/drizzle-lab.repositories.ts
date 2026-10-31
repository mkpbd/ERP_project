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
import type { CultureReport, ReportForm, Sensitivity } from '../../domain/culture.js';
import { LabResult, LabSample, type Parameter, type ResultValue } from '../../domain/lab.js';
import { LabRepository } from '../../domain/repositories.js';
import {
  labAntibiotics,
  labCultureOrganisms,
  labCultureReports,
  labCultureSensitivities,
  labGrowthTypes,
  labOrganisms,
  labParameterRanges,
  labParameters,
  labResults,
  labResultValues,
  labSamples,
  labSequences,
  labTestForms,
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

/** The culture reports of results, with their organisms and antibiogram in order. */
async function culturesOf(context: DbContext, resultIds: readonly string[]): Promise<Map<string, CultureReport>> {
  const map = new Map<string, CultureReport>();
  if (resultIds.length === 0) return map;
  const ids = [...resultIds];
  const [reports, organisms, sensitivities] = await Promise.all([
    context.db.select().from(labCultureReports).where(inArray(labCultureReports.resultId, ids)),
    context.db
      .select()
      .from(labCultureOrganisms)
      .where(inArray(labCultureOrganisms.resultId, ids))
      .orderBy(asc(labCultureOrganisms.position)),
    context.db
      .select()
      .from(labCultureSensitivities)
      .where(inArray(labCultureSensitivities.resultId, ids))
      .orderBy(asc(labCultureSensitivities.position)),
  ]);
  for (const { resultId, ...report } of reports) {
    const isolated = organisms
      .filter((row) => row.resultId === resultId)
      .map((row) => ({ organismId: row.organismId, name: row.name }));
    map.set(resultId, {
      ...report,
      organisms: isolated,
      sensitivity: sensitivities
        .filter((row) => row.resultId === resultId)
        .map((row) => ({
          antibioticId: row.antibioticId,
          antibiotic: row.antibiotic,
          zone: row.zone,
          results: [row.result1, row.result2, row.result3].slice(0, isolated.length),
        })),
    });
  }
  return map;
}

async function writeCulture(context: DbContext, resultId: string, culture: CultureReport | null): Promise<void> {
  await context.db.delete(labCultureReports).where(eq(labCultureReports.resultId, resultId));
  await context.db.delete(labCultureOrganisms).where(eq(labCultureOrganisms.resultId, resultId));
  await context.db.delete(labCultureSensitivities).where(eq(labCultureSensitivities.resultId, resultId));
  if (!culture) return;
  const { organisms, sensitivity, ...report } = culture;
  await context.db.insert(labCultureReports).values({ ...report, resultId });
  if (organisms.length > 0) {
    await context.db
      .insert(labCultureOrganisms)
      .values(organisms.map((organism, index) => ({ ...organism, resultId, position: index + 1 })));
  }
  if (sensitivity.length > 0) {
    const at = (results: readonly (Sensitivity | null)[], index: number) => results[index] ?? null;
    await context.db.insert(labCultureSensitivities).values(
      sensitivity.map((row, index) => ({
        resultId,
        position: index + 1,
        antibioticId: row.antibioticId,
        antibiotic: row.antibiotic,
        zone: row.zone,
        result1: at(row.results, 0),
        result2: at(row.results, 1),
        result3: at(row.results, 2),
      })),
    );
  }
}

const restoreResult = (
  row: typeof labResults.$inferSelect,
  values: Map<string, ResultValue[]>,
  cultures: Map<string, CultureReport>,
) => LabResult.restore({ ...row, values: values.get(row.id) ?? [], culture: cultures.get(row.id) ?? null });

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

  async form(testId: string): Promise<ReportForm> {
    const [row] = await this.context.db
      .select({ form: labTestForms.form })
      .from(labTestForms)
      .where(eq(labTestForms.testId, testId));
    return row?.form ?? 'values';
  }

  async forms(testIds: readonly string[]): Promise<Map<string, ReportForm>> {
    if (testIds.length === 0) return new Map();
    const rows = await this.context.db
      .select({ testId: labTestForms.testId, form: labTestForms.form })
      .from(labTestForms)
      .where(inArray(labTestForms.testId, [...testIds]));
    return new Map(rows.map((row) => [row.testId, row.form]));
  }

  async setForm(testId: string, form: ReportForm): Promise<void> {
    if (form === 'values') {
      await this.context.db.delete(labTestForms).where(eq(labTestForms.testId, testId));
      return;
    }
    await this.context.db
      .insert(labTestForms)
      .values({ testId, form })
      .onConflictDoUpdate({ target: labTestForms.testId, set: { form, updatedAt: sql`now()` } });
  }

  async cultureNames(ids: {
    readonly organisms: readonly string[];
    readonly antibiotics: readonly string[];
    readonly growthTypes: readonly string[];
  }) {
    const named = async (
      table: typeof labOrganisms | typeof labAntibiotics | typeof labGrowthTypes,
      of: readonly string[],
    ) =>
      of.length === 0
        ? new Map<string, string>()
        : new Map(
            (
              await this.context.db
                .select({ id: table.id, name: table.name })
                .from(table)
                .where(inArray(table.id, [...of]))
            ).map((row) => [row.id, row.name]),
          );
    const [organisms, antibiotics, growthTypes] = await Promise.all([
      named(labOrganisms, ids.organisms),
      named(labAntibiotics, ids.antibiotics),
      named(labGrowthTypes, ids.growthTypes),
    ]);
    return { organisms, antibiotics, growthTypes };
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
      const { values: _values, culture: _culture, ...row } = result.toSnapshot();
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
    const ids = rows.map((row) => row.id);
    const [values, cultures] = await Promise.all([valuesOf(this.context, ids), culturesOf(this.context, ids)]);
    return rows.map((row) => restoreResult(row, values, cultures));
  }

  async resultForUpdate(id: string): Promise<LabResult | null> {
    const [row] = await this.context.db.select().from(labResults).where(eq(labResults.id, id)).for('update');
    if (!row) return null;
    const [values, cultures] = await Promise.all([valuesOf(this.context, [id]), culturesOf(this.context, [id])]);
    return restoreResult(row, values, cultures);
  }

  async updateResult(result: LabResult): Promise<void> {
    const { id, values, culture, ...row } = result.toSnapshot();
    await this.context.db.update(labResults).set(row).where(eq(labResults.id, id));
    await writeCulture(this.context, id, culture);
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
        reagents: labResults.reagents,
        form: labResults.form,
        narrative: labResults.narrative,
      })
      .from(labResults)
      .innerJoin(labSamples, eq(labSamples.id, labResults.sampleId))
      .where(where)
      .orderBy(asc(labResults.line));
    const ids = rows.map((row) => row.id);
    const [values, cultures] = await Promise.all([valuesOf(this.context, ids), culturesOf(this.context, ids)]);
    return rows.map((row) => ({ ...row, values: values.get(row.id) ?? [], culture: cultures.get(row.id) ?? null }));
  }

  async result(id: string): Promise<ResultRecord | null> {
    const [row] = await this.records(eq(labResults.id, id));
    return row ?? null;
  }
}
