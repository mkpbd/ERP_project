import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import { DomainError, NotFoundError } from '../../../shared/domain/errors.js';
import { dayBounds, nextDay, zonedInstant } from '../../../shared/domain/zoned-time.js';
import { checkedObservation, inRound, roundState, vitalFlags, type ObservationRound } from '../domain/observation.js';
import { text } from '../domain/prescription.js';
import { ObservationRepository, type ObservationRow } from '../domain/repositories.js';
import { EmrDesk } from './emr.handlers.js';
import { EMR_READ, EMR_WRITE } from './emr.messages.js';
import {
  ListObservationsQuery,
  ObservationBoardQuery,
  ObservationReadRepository,
  RecordObservationCommand,
  StrikeObservationCommand,
} from './observation.messages.js';

/** An observation is written up to a day late (a round charted after a busy night), never ahead. */
const LATE_HOURS = 24;
/** The longest period read at once. */
const MAX_DAYS = 31;

@Injectable()
export class ObservationDesk {
  constructor(
    readonly emr: EmrDesk,
    readonly observations: ObservationRepository,
    readonly read: ObservationReadRepository,
  ) {}

  /** HH:MM of an instant in the organisation's time zone. */
  timeOf(at: Date): string {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: this.emr.settings.timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(at);
  }

  /** The round whose window holds the moment, and the day that window began (a night round began the day before). */
  roundAt(rounds: readonly ObservationRound[], at: Date): { round: ObservationRound; on: string } | null {
    const time = this.timeOf(at);
    const round = rounds.find((candidate) => inRound(candidate, time));
    if (!round) return null;
    const day = this.emr.dayOf(at);
    const wrapped = round.endTime <= round.startTime && time < round.endTime;
    return {
      round,
      on: wrapped ? this.emr.dayOf(new Date(dayBounds(day, this.emr.settings.timeZone)[0].getTime() - 1)) : day,
    };
  }

  /** A round's window on a day. */
  window(round: ObservationRound, day: string): [Date, Date] {
    const timeZone = this.emr.settings.timeZone;
    const start = zonedInstant(day, round.startTime, timeZone);
    const end = zonedInstant(round.endTime > round.startTime ? day : nextDay(day), round.endTime, timeZone);
    return [start, end];
  }

  /** Observations with the round's, the nurse's and the striker's names and their flags. */
  async named(rows: readonly ObservationRow[]) {
    const rounds = await this.read.roundNames();
    const ids = [...new Set(rows.flatMap((row) => [row.recordedBy, ...(row.struckBy ? [row.struckBy] : [])]))];
    const users = new Map((ids.length ? await this.emr.users.findSummaries(ids) : []).map((u) => [u.id, u]));
    return rows.map(({ recordedBy, struckBy, ...row }) => ({
      ...row,
      roundName: row.roundId ? (rounds.get(row.roundId) ?? null) : null,
      recordedByName: users.get(recordedBy)?.displayName ?? '',
      struckByName: struckBy ? (users.get(struckBy)?.displayName ?? null) : null,
      flags: vitalFlags(row),
    }));
  }
}

/**
 * Old follow-up sheet entry (a dynamic form per scheduled round): an admitted patient's vital signs and observations,
 * taken now or up to a day ago, answering the round whose window holds the time. Readings a nurse should report are
 * flagged.
 */
@CommandHandler(RecordObservationCommand)
export class RecordObservationHandler implements ICommandHandler<RecordObservationCommand> {
  constructor(private readonly desk: ObservationDesk) {}

  async execute({ actor, admissionId, observation, takenAt }: RecordObservationCommand) {
    const { desk } = this;
    const { emr } = desk;
    await emr.access.authorize(actor.userId, { permissions: [EMR_WRITE] });
    const admission = await emr.admitted(admissionId);
    const now = emr.clock.now();
    const at = takenAt ?? now;
    if (at.getTime() > now.getTime() + 5 * 60_000)
      throw new DomainError('invalid_time', 'An observation is taken, not planned');
    if (at.getTime() < now.getTime() - LATE_HOURS * 3_600_000) {
      throw new DomainError('invalid_time', `An observation is written within ${LATE_HOURS} hours`);
    }
    if (emr.dayOf(at) < admission.admittedOn) {
      throw new DomainError('invalid_time', 'The observation is not before the admission');
    }
    const checked = checkedObservation(observation);
    const answered = desk.roundAt(await desk.observations.rounds(), at);
    const row: ObservationRow = {
      ...checked,
      id: randomUUID(),
      admissionId,
      patientId: admission.patientId,
      takenAt: at,
      roundId: answered?.round.id ?? null,
      roundOn: answered?.on ?? null,
      recordedBy: actor.userId,
      struckAt: null,
      struckBy: null,
      struckReason: null,
      createdAt: now,
    };
    await desk.observations.insert(row);
    return { id: row.id, flags: vitalFlags(checked) };
  }
}

@CommandHandler(StrikeObservationCommand)
export class StrikeObservationHandler implements ICommandHandler<StrikeObservationCommand> {
  constructor(private readonly desk: ObservationDesk) {}

  async execute({ actor, id, reason }: StrikeObservationCommand): Promise<void> {
    const { desk } = this;
    const { emr } = desk;
    await emr.access.authorize(actor.userId, { permissions: [EMR_WRITE] });
    await emr.tx.run(async () => {
      const row = await desk.observations.findForUpdate(id);
      if (!row) throw new NotFoundError('observation');
      if (row.struckAt) throw new DomainError('observation_struck', 'The observation is struck through already');
      await emr.admitted(row.admissionId);
      const why = text(reason, 300, 'reason');
      if (!why) throw new DomainError('invalid_text', 'Give why it was entered in error');
      await desk.observations.strike(id, actor.userId, emr.clock.now(), why);
      await emr.record('observation', 'struck', actor, id, { reason: why });
    });
  }
}

/** Old follow-up data view: the observation sheet of one or more days, struck entries shown as such. */
@QueryHandler(ListObservationsQuery)
export class ListObservationsHandler implements IQueryHandler<ListObservationsQuery> {
  constructor(private readonly desk: ObservationDesk) {}

  async execute({ actor, admissionId, from, to }: ListObservationsQuery) {
    const { desk } = this;
    const { emr } = desk;
    await emr.access.authorize(actor.userId, { permissions: [EMR_READ] });
    const today = emr.dayOf(emr.clock.now());
    const first = from ?? to ?? today;
    const last = to ?? from ?? today;
    if (first > last) throw new DomainError('invalid_period', 'The start date is after the end date');
    if (Date.parse(last) - Date.parse(first) > MAX_DAYS * 86_400_000) {
      throw new DomainError('invalid_period', `At most ${MAX_DAYS} days at once`);
    }
    const [admission] = await emr.inpatients.find([admissionId]);
    if (!admission) throw new NotFoundError('admission');
    const timeZone = emr.settings.timeZone;
    const rows = await desk.read.list(admissionId, dayBounds(first, timeZone)[0], dayBounds(last, timeZone)[1]);
    return desk.named(rows);
  }
}

/**
 * The wards' observation board: every admitted patient by ward and bed, each round of the day done, due (its window
 * open), missed or still to come, and the flags of their latest observation.
 */
@QueryHandler(ObservationBoardQuery)
export class ObservationBoardHandler implements IQueryHandler<ObservationBoardQuery> {
  constructor(private readonly desk: ObservationDesk) {}

  async execute({ actor, day }: ObservationBoardQuery) {
    const { desk } = this;
    const { emr } = desk;
    await emr.access.authorize(actor.userId, { permissions: [EMR_READ] });
    const now = emr.clock.now();
    const on = day ?? emr.dayOf(now);
    const rounds = await desk.observations.rounds();
    const inpatients = await emr.inpatients.inpatients();
    const ids = inpatients.map((inpatient) => inpatient.id);
    const [answered, latest] = await Promise.all([desk.read.answered(ids, on), desk.read.latest(ids)]);
    const windows = rounds.map((round) => desk.window(round, on));
    return {
      day: on,
      rounds: rounds.map(({ id, name, startTime, endTime }) => ({ id, name, startTime, endTime })),
      patients: inpatients.map((inpatient) => {
        const done = answered.get(inpatient.id) ?? new Set<string>();
        const last = latest.get(inpatient.id) ?? null;
        return {
          admissionId: inpatient.id,
          admissionNumber: inpatient.number,
          patientName: inpatient.patientName,
          uhid: inpatient.uhid,
          wardName: inpatient.wardName,
          bedCode: inpatient.bedCode,
          rounds: rounds.map((round, index) =>
            inpatient.admittedOn > on ? null : roundState(done.has(round.id), ...windows[index]!, now),
          ),
          lastAt: last?.takenAt ?? null,
          lastFlags: last ? vitalFlags(last) : [],
        };
      }),
    };
  }
}

export const OBSERVATION_HANDLERS = [
  ObservationDesk,
  RecordObservationHandler,
  StrikeObservationHandler,
  ListObservationsHandler,
  ObservationBoardHandler,
];
