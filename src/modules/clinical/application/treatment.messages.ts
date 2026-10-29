import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { DoseRecordRow, SummaryRow } from '../domain/repositories.js';
import type { OrderProps, OrderStatus, Route, Schedule, SummaryContent } from '../domain/treatment.js';

/** Doctors ordering, holding and stopping treatment, and writing the discharge summary. */
export const EMR_ORDER = 'emr:order';

export type OrderRow = Omit<OrderProps, 'createdAt'>;

export interface OrderView extends Omit<OrderRow, 'events'> {
  readonly doctorName: string;
  readonly events: (OrderProps['events'][number] & { readonly byName: string })[];
}

export type DoseState = 'given' | 'missed' | 'due' | 'overdue';

export interface ChartView {
  readonly day: string;
  readonly orders: (OrderView & {
    readonly slots: { readonly dueAt: Date; readonly state: DoseState; readonly record: DoseRecordRow | null }[];
    /** When-needed doses given that day. */
    readonly doses: DoseRecordRow[];
  })[];
}

export interface SummaryView extends SummaryRow {
  readonly doctorName: string;
}

export abstract class TreatmentReadRepository {
  /** The admission's orders (by status) with their events, oldest first. */
  abstract orders(admissionId: string, status?: OrderStatus): Promise<OrderRow[]>;
  /** Doses recorded for the admission due (or given, when needed) within [from, to). */
  abstract doses(admissionId: string, from: Date, to: Date): Promise<DoseRecordRow[]>;
  abstract summary(admissionId: string): Promise<SummaryRow | null>;
}

export interface OrderInput {
  readonly productId: string | null;
  /** Needed when no product is given. */
  readonly drugName: string | null;
  readonly dose: string;
  readonly route: Route;
  readonly schedule: Schedule;
  readonly times: string[];
  readonly intervalHours: number | null;
  /** Now when not given. */
  readonly startAt: Date | null;
  readonly note: string | null;
  /** The doctor signed in when not given. */
  readonly doctorId: string | null;
}

export class StartOrderCommand extends Command<{ id: string }> {
  constructor(
    readonly actor: Actor,
    readonly admissionId: string,
    readonly input: OrderInput,
  ) {
    super();
  }
}

export class ChangeOrderCommand extends Command<{ version: number }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly action: 'hold' | 'resume' | 'stop',
    readonly reason: string | null,
  ) {
    super();
  }
}

export interface DoseInput {
  /** The due time answered; null for a when-needed dose. */
  readonly dueAt: Date | null;
  readonly outcome: 'given' | 'missed';
  /** When given (now when not given); none when missed. */
  readonly givenAt: Date | null;
  /** Why missed. */
  readonly reason: string | null;
}

export class RecordDoseCommand extends Command<{ id: string }> {
  constructor(
    readonly actor: Actor,
    readonly orderId: string,
    readonly input: DoseInput,
  ) {
    super();
  }
}

export class WriteSummaryCommand extends Command<{ version: number }> {
  constructor(
    readonly actor: Actor,
    readonly admissionId: string,
    /** Null for the first draft. */
    readonly version: number | null,
    readonly doctorId: string | null,
    readonly content: SummaryContent,
  ) {
    super();
  }
}

export class SignSummaryCommand extends Command<{ version: number }> {
  constructor(
    readonly actor: Actor,
    readonly admissionId: string,
    readonly version: number,
    readonly action: 'sign' | 'reopen',
  ) {
    super();
  }
}

export class ListOrdersQuery extends Query<OrderView[]> {
  constructor(
    readonly actor: Actor,
    readonly admissionId: string,
    readonly status?: OrderStatus,
  ) {
    super();
  }
}

export class GetChartQuery extends Query<ChartView> {
  constructor(
    readonly actor: Actor,
    readonly admissionId: string,
    readonly day: string | null,
  ) {
    super();
  }
}

export class GetSummaryQuery extends Query<SummaryView> {
  constructor(
    readonly actor: Actor,
    readonly admissionId: string,
  ) {
    super();
  }
}
