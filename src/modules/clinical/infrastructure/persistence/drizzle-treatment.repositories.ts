import { Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNull, lt, or, type SQL } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { ConflictError } from '../../../../shared/domain/errors.js';
import { uniqueViolationConstraint } from '../../../../shared/infrastructure/persistence/pg-errors.js';
import { TreatmentReadRepository, type OrderRow } from '../../application/treatment.messages.js';
import { TreatmentRepository, type DoseRecordRow, type SummaryRow } from '../../domain/repositories.js';
import { TreatmentOrder, type OrderEvent, type OrderProps, type OrderStatus } from '../../domain/treatment.js';
import { dischargeSummaries, doseRecords, orderEvents, treatmentOrders } from './clinical.schema.js';

/** Orders with their events, in order. */
async function loadOrders(context: DbContext, where: SQL, lock = false): Promise<OrderProps[]> {
  const query = context.db.select().from(treatmentOrders).where(where).orderBy(asc(treatmentOrders.createdAt));
  const rows = lock ? await query.for('update') : await query;
  if (rows.length === 0) return [];
  const events = await context.db
    .select()
    .from(orderEvents)
    .where(
      inArray(
        orderEvents.orderId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(orderEvents.orderId), asc(orderEvents.position));
  return rows.map((row) => ({
    ...row,
    events: events
      .filter((entry) => entry.orderId === row.id)
      .map(({ event, at, note, by }): OrderEvent => ({ event, at, note, by })),
  }));
}

@Injectable()
export class DrizzleTreatmentRepository extends TreatmentRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async insertOrder(order: TreatmentOrder): Promise<void> {
    const { events, ...row } = order.toSnapshot();
    await this.context.db.insert(treatmentOrders).values({ ...row, times: [...row.times] });
    await this.context.db
      .insert(orderEvents)
      .values(events.map((entry, index) => ({ ...entry, orderId: row.id, position: index + 1 })));
  }

  async orderForUpdate(id: string): Promise<TreatmentOrder | null> {
    const [props] = await loadOrders(this.context, eq(treatmentOrders.id, id), true);
    return props ? TreatmentOrder.restore(props) : null;
  }

  async updateOrder(order: TreatmentOrder): Promise<void> {
    const { events, id, status, version, updatedAt } = order.toSnapshot();
    await this.context.db.update(treatmentOrders).set({ status, version, updatedAt }).where(eq(treatmentOrders.id, id));
    await this.context.db.delete(orderEvents).where(eq(orderEvents.orderId, id));
    await this.context.db
      .insert(orderEvents)
      .values(events.map((entry, index) => ({ ...entry, orderId: id, position: index + 1 })));
  }

  async insertDose(dose: DoseRecordRow): Promise<void> {
    try {
      await this.context.db.insert(doseRecords).values(dose);
    } catch (error) {
      if (uniqueViolationConstraint(error) === 'clinical_dose_records_due_uq') {
        throw new ConflictError('dose_recorded', 'This dose is recorded already');
      }
      throw error;
    }
  }

  async summaryForUpdate(admissionId: string): Promise<SummaryRow | null> {
    const [row] = await this.context.db
      .select()
      .from(dischargeSummaries)
      .where(eq(dischargeSummaries.admissionId, admissionId))
      .for('update');
    return row ?? null;
  }

  async saveSummary(summary: SummaryRow, isNew: boolean): Promise<void> {
    if (isNew) {
      await this.context.db.insert(dischargeSummaries).values(summary);
      return;
    }
    const { id, createdAt: _created, ...rest } = summary;
    await this.context.db.update(dischargeSummaries).set(rest).where(eq(dischargeSummaries.id, id));
  }
}

@Injectable()
export class DrizzleTreatmentReadRepository extends TreatmentReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async orders(admissionId: string, status?: OrderStatus): Promise<OrderRow[]> {
    const where = status
      ? and(eq(treatmentOrders.admissionId, admissionId), eq(treatmentOrders.status, status))!
      : eq(treatmentOrders.admissionId, admissionId);
    return (await loadOrders(this.context, where)).map(({ createdAt: _created, ...row }) => row);
  }

  doses(admissionId: string, from: Date, to: Date): Promise<DoseRecordRow[]> {
    return this.context.db
      .select()
      .from(doseRecords)
      .where(
        and(
          eq(doseRecords.admissionId, admissionId),
          or(
            and(gte(doseRecords.dueAt, from), lt(doseRecords.dueAt, to)),
            and(isNull(doseRecords.dueAt), gte(doseRecords.givenAt, from), lt(doseRecords.givenAt, to)),
          ),
        ),
      )
      .orderBy(asc(doseRecords.createdAt));
  }

  async summary(admissionId: string): Promise<SummaryRow | null> {
    const [row] = await this.context.db
      .select()
      .from(dischargeSummaries)
      .where(eq(dischargeSummaries.admissionId, admissionId));
    return row ?? null;
  }
}
