import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import { MedicineCatalogue } from '../../../shared/application/contracts/medicine-catalogue.js';
import { ConflictError, DomainError, NotFoundError } from '../../../shared/domain/errors.js';
import { text } from '../domain/prescription.js';
import { TreatmentRepository, type DoseRecordRow, type SummaryRow } from '../domain/repositories.js';
import {
  activePeriods,
  checkedSummary,
  dayBounds,
  dueTimes,
  TreatmentOrder,
  type OrderKind,
} from '../domain/treatment.js';
import { EmrDesk } from './emr.handlers.js';
import { EMR_READ, EMR_WRITE } from './emr.messages.js';
import {
  ChangeOrderCommand,
  EMR_ORDER,
  GetChartQuery,
  GetSummaryQuery,
  ListOrdersQuery,
  RecordDoseCommand,
  SignSummaryCommand,
  StartOrderCommand,
  TreatmentReadRepository,
  WriteSummaryCommand,
  type DoseState,
  type OrderRow,
} from './treatment.messages.js';

const HOUR = 3_600_000;
/** A dose may be given this early before it is due. */
const EARLY_HOURS = 2;
/** Not given an hour after it was due: overdue on the chart. */
const OVERDUE_HOURS = 1;
/** An order may start this many days ahead. */
const AHEAD_DAYS = 7;

@Injectable()
export class TreatmentDesk {
  constructor(
    readonly emr: EmrDesk,
    readonly treatment: TreatmentRepository,
    readonly read: TreatmentReadRepository,
    readonly medicines: MedicineCatalogue,
  ) {}

  /** The doctor named, or the one signed in. */
  async doctorFor(actor: Actor, doctorId: string | null): Promise<string> {
    const id = doctorId ?? (await this.emr.clinic.doctorOfUser(actor.userId))?.id;
    if (!id) throw new DomainError('doctor_needed', 'Name the ordering doctor');
    await this.emr.activeDoctor(id);
    return id;
  }

  /** Orders with their doctors' and event writers' names. */
  async named(rows: readonly OrderRow[]) {
    const doctors = await this.emr.clinic.doctors(rows.map((row) => row.doctorId));
    const userIds = [...new Set(rows.flatMap((row) => row.events.map((entry) => entry.by)))];
    const users = new Map((userIds.length ? await this.emr.users.findSummaries(userIds) : []).map((u) => [u.id, u]));
    return rows.map((row) => ({
      ...row,
      doctorName: doctors.get(row.doctorId)?.name ?? '',
      events: row.events.map((entry) => ({ ...entry, byName: users.get(entry.by)?.displayName ?? '' })),
    }));
  }

  async summaryView(admissionId: string) {
    const summary = await this.read.summary(admissionId);
    if (!summary) throw new NotFoundError('discharge_summary');
    const doctor = (await this.emr.clinic.doctors([summary.doctorId])).get(summary.doctorId);
    return { ...summary, doctorName: doctor?.name ?? '' };
  }
}

/**
 * Old RxIpdTreatment and Non Medication Order entry: a medicine with its dose, route and times, or nursing care with
 * its times (from now, or a set time).
 */
@CommandHandler(StartOrderCommand)
export class StartOrderHandler implements ICommandHandler<StartOrderCommand> {
  constructor(private readonly desk: TreatmentDesk) {}

  async execute({ actor, admissionId, input }: StartOrderCommand) {
    const { desk } = this;
    const { emr } = desk;
    await emr.access.authorize(actor.userId, { permissions: [EMR_ORDER] });
    const admission = await emr.admitted(admissionId);
    const doctorId = await desk.doctorFor(actor, input.doctorId);
    let drugName = input.drugName;
    if (input.productId && input.kind === 'medicine') {
      const product = (await desk.medicines.find([input.productId])).get(input.productId);
      if (!product) throw new NotFoundError('medicine');
      drugName = product.name;
    }
    const now = emr.clock.now();
    const startAt = input.startAt ?? now;
    if (startAt.getTime() > now.getTime() + AHEAD_DAYS * 24 * HOUR) {
      throw new DomainError('invalid_time', `An order starts within ${AHEAD_DAYS} days`);
    }
    if (emr.dayOf(startAt) < admission.admittedOn) {
      throw new DomainError('invalid_time', 'The order does not start before the admission');
    }
    const order = TreatmentOrder.start({
      ...input,
      id: randomUUID(),
      admissionId,
      patientId: admission.patientId,
      drugName: drugName ?? '',
      startAt,
      doctorId,
      by: actor.userId,
      at: now,
    });
    await desk.treatment.insertOrder(order);
    return { id: order.id };
  }
}

/** Held (and resumed) or stopped by the doctor, with the reason (old HoldingNote / StoppingNote). */
@CommandHandler(ChangeOrderCommand)
export class ChangeOrderHandler implements ICommandHandler<ChangeOrderCommand> {
  constructor(private readonly desk: TreatmentDesk) {}

  async execute({ actor, id, version, action, reason }: ChangeOrderCommand) {
    const { desk } = this;
    const { emr } = desk;
    await emr.access.authorize(actor.userId, { permissions: [EMR_ORDER] });
    return emr.tx.run(async () => {
      const order = await desk.treatment.orderForUpdate(id);
      if (!order) throw new NotFoundError('treatment_order');
      order.assertVersion(version);
      if (action !== 'stop') await emr.admitted(order.admissionId);
      const now = emr.clock.now();
      if (action === 'hold') order.hold(reason ?? '', actor.userId, now);
      else if (action === 'resume') order.resume(actor.userId, now);
      else order.stop(reason ?? '', actor.userId, now);
      await desk.treatment.updateOrder(order);
      return { version: order.toSnapshot().version };
    });
  }
}

/**
 * Old AppliedMedicationDose: a due dose given (up to two hours early) or missed with the reason; a when-needed dose
 * when given, while the order is in force.
 */
@CommandHandler(RecordDoseCommand)
export class RecordDoseHandler implements ICommandHandler<RecordDoseCommand> {
  constructor(private readonly desk: TreatmentDesk) {}

  async execute({ actor, orderId, input }: RecordDoseCommand) {
    const { desk } = this;
    const { emr } = desk;
    await emr.access.authorize(actor.userId, { permissions: [EMR_WRITE] });
    return emr.tx.run(async () => {
      const order = await desk.treatment.orderForUpdate(orderId);
      if (!order) throw new NotFoundError('treatment_order');
      await emr.admitted(order.admissionId);
      const now = emr.clock.now();
      const givenAt = input.outcome === 'given' ? (input.givenAt ?? now) : null;
      if (input.outcome === 'missed' && input.givenAt) {
        throw new DomainError('invalid_dose', 'A missed dose has no time given');
      }
      if (givenAt && givenAt.getTime() > now.getTime() + 5 * 60_000) {
        throw new DomainError('invalid_time', 'A dose is recorded once given');
      }
      const reason = text(input.reason, 300, 'reason');
      if (input.outcome === 'missed' && !reason) throw new DomainError('invalid_text', 'Give why the dose was missed');
      if (order.schedule === 'prn') {
        if (input.dueAt || input.outcome !== 'given') {
          throw new DomainError('invalid_dose', 'A when-needed dose is recorded when given');
        }
        if (!order.inForceAt(givenAt!)) throw new DomainError('order_state', 'The order was not in force then');
      } else {
        if (!input.dueAt) throw new DomainError('invalid_dose', 'Name the due time the dose answers');
        const day = emr.dayOf(input.dueAt);
        const [from, to] = dayBounds(day, emr.settings.timeZone);
        const due = dueTimes(order.toSnapshot(), order.periods, from, to, emr.settings.timeZone, emr.dayOf);
        if (!due.some((at) => at.getTime() === input.dueAt!.getTime())) {
          throw new DomainError('not_due', 'No dose of the order is due then');
        }
        if (input.outcome === 'missed' && input.dueAt.getTime() > now.getTime()) {
          throw new DomainError('not_due', 'A dose is missed once its time has come');
        }
        if (givenAt && givenAt.getTime() < input.dueAt.getTime() - EARLY_HOURS * HOUR) {
          throw new DomainError('invalid_time', `A dose is given at most ${EARLY_HOURS} hours early`);
        }
      }
      const dose: DoseRecordRow = {
        id: randomUUID(),
        orderId,
        admissionId: order.admissionId,
        dueAt: input.dueAt,
        outcome: input.outcome,
        givenAt,
        reason,
        recordedBy: actor.userId,
        createdAt: now,
      };
      await desk.treatment.insertDose(dose);
      return { id: dose.id };
    });
  }
}

/** Old discharge certificate with treatment, diet and advice on discharge: a draft until the doctor signs it. */
@CommandHandler(WriteSummaryCommand)
export class WriteSummaryHandler implements ICommandHandler<WriteSummaryCommand> {
  constructor(private readonly desk: TreatmentDesk) {}

  async execute({ actor, admissionId, version, doctorId, content }: WriteSummaryCommand) {
    const { desk } = this;
    const { emr } = desk;
    await emr.access.authorize(actor.userId, { permissions: [EMR_ORDER] });
    const admission = await emr.admitted(admissionId);
    const now = emr.clock.now();
    const checked = checkedSummary(content, emr.dayOf(now));
    return emr.tx.run(async () => {
      const existing = await desk.treatment.summaryForUpdate(admissionId);
      if (existing) {
        if (existing.version !== version) {
          throw new ConflictError('stale_summary', 'The summary was changed meanwhile; reload it');
        }
        if (existing.status === 'signed') throw new DomainError('summary_signed', 'Reopen the signed summary first');
      } else if (version !== null) {
        throw new NotFoundError('discharge_summary');
      }
      const summary: SummaryRow = {
        ...checked,
        id: existing?.id ?? randomUUID(),
        admissionId,
        patientId: admission.patientId,
        doctorId: doctorId
          ? await desk.doctorFor(actor, doctorId)
          : (existing?.doctorId ?? (await desk.doctorFor(actor, null))),
        status: 'draft',
        signedBy: null,
        signedAt: null,
        writtenBy: actor.userId,
        version: (existing?.version ?? 0) + 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await desk.treatment.saveSummary(summary, !existing);
      return { version: summary.version };
    });
  }
}

@CommandHandler(SignSummaryCommand)
export class SignSummaryHandler implements ICommandHandler<SignSummaryCommand> {
  constructor(private readonly desk: TreatmentDesk) {}

  async execute({ actor, admissionId, version, action }: SignSummaryCommand) {
    const { desk } = this;
    const { emr } = desk;
    await emr.access.authorize(actor.userId, { permissions: [EMR_ORDER] });
    await emr.admitted(admissionId);
    return emr.tx.run(async () => {
      const summary = await desk.treatment.summaryForUpdate(admissionId);
      if (!summary) throw new NotFoundError('discharge_summary');
      if (summary.version !== version) {
        throw new ConflictError('stale_summary', 'The summary was changed meanwhile; reload it');
      }
      const now = emr.clock.now();
      if (action === 'sign') {
        if (summary.status === 'signed') throw new DomainError('summary_signed', 'The summary is signed');
        if (!summary.diagnosis) throw new DomainError('diagnosis_needed', 'Write the diagnosis before signing');
      } else if (summary.status !== 'signed') {
        throw new DomainError('summary_state', 'The summary is a draft');
      }
      const saved: SummaryRow = {
        ...summary,
        status: action === 'sign' ? 'signed' : 'draft',
        signedBy: action === 'sign' ? actor.userId : null,
        signedAt: action === 'sign' ? now : null,
        version: summary.version + 1,
        updatedAt: now,
      };
      await desk.treatment.saveSummary(saved, false);
      await emr.record('discharge_summary', action === 'sign' ? 'signed' : 'reopened', actor, summary.id);
      return { version: saved.version };
    });
  }
}

@QueryHandler(ListOrdersQuery)
export class ListOrdersHandler implements IQueryHandler<ListOrdersQuery> {
  constructor(private readonly desk: TreatmentDesk) {}

  async execute({ actor, admissionId, status }: ListOrdersQuery) {
    await this.desk.emr.access.authorize(actor.userId, { permissions: [EMR_READ] });
    return this.desk.named(await this.desk.read.orders(admissionId, status));
  }
}

/** The medication chart of a day: each order's due doses as given, missed, due or overdue, and when-needed doses. */
@QueryHandler(GetChartQuery)
export class GetChartHandler implements IQueryHandler<GetChartQuery> {
  constructor(private readonly desk: TreatmentDesk) {}

  async execute({ actor, admissionId, day, kind }: GetChartQuery) {
    const { desk } = this;
    const { emr } = desk;
    await emr.access.authorize(actor.userId, { permissions: [EMR_READ] });
    return chart(desk, admissionId, day ?? emr.dayOf(emr.clock.now()), kind);
  }
}

export async function chart(desk: TreatmentDesk, admissionId: string, day: string, kind: OrderKind | null = null) {
  const { emr } = desk;
  const [admission] = await emr.inpatients.find([admissionId]);
  if (!admission) throw new NotFoundError('admission');
  const timeZone = emr.settings.timeZone;
  const [from, to] = dayBounds(day, timeZone);
  const now = emr.clock.now();
  const orders = (await desk.named(await desk.read.orders(admissionId))).filter(
    (order) => kind === null || order.kind === kind,
  );
  const doses = await desk.read.doses(admissionId, from, to);
  const shown = orders
    .map((order) => {
      const periods = activePeriods(order.events);
      const due = dueTimes(order, periods, from, to, timeZone, emr.dayOf);
      const mine = doses.filter((dose) => dose.orderId === order.id);
      const slots = due.map((dueAt) => {
        const record = mine.find((dose) => dose.dueAt?.getTime() === dueAt.getTime()) ?? null;
        const state: DoseState = record
          ? record.outcome
          : now.getTime() - dueAt.getTime() > OVERDUE_HOURS * HOUR
            ? 'overdue'
            : 'due';
        return { dueAt, state, record };
      });
      const inForceThatDay = periods.some(
        ([start, end]) => start.getTime() < to.getTime() && (end === null || end.getTime() > from.getTime()),
      );
      return { ...order, slots, doses: mine.filter((dose) => dose.dueAt === null), inForceThatDay };
    })
    .filter((order) => order.inForceThatDay || order.slots.length > 0 || order.doses.length > 0)
    .map(({ inForceThatDay: _shown, ...order }) => order);
  return { day, admission, orders: shown };
}

@QueryHandler(GetSummaryQuery)
export class GetSummaryHandler implements IQueryHandler<GetSummaryQuery> {
  constructor(private readonly desk: TreatmentDesk) {}

  async execute({ actor, admissionId }: GetSummaryQuery) {
    await this.desk.emr.access.authorize(actor.userId, { permissions: [EMR_READ] });
    return this.desk.summaryView(admissionId);
  }
}

export const TREATMENT_HANDLERS = [
  TreatmentDesk,
  StartOrderHandler,
  ChangeOrderHandler,
  RecordDoseHandler,
  WriteSummaryHandler,
  SignSummaryHandler,
  ListOrdersHandler,
  GetChartHandler,
  GetSummaryHandler,
];
