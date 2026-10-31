import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from '../../../shared/domain/errors.js';
import { dayBounds } from '../../../shared/domain/zoned-time.js';
import { OtCase } from '../domain/ot-case.js';
import { OtCaseRepository } from '../domain/repositories.js';
import { IpdDesk } from './ipd.handlers.js';
import {
  CancelOtCommand,
  ChangeOtCommand,
  GetOtCaseQuery,
  ListOtCasesQuery,
  MoveOtCommand,
  OT_NOTE,
  OT_READ,
  OT_REQUEST,
  OT_SCHEDULE,
  OtBoardQuery,
  OtReadRepository,
  RequestOtCommand,
  ScheduleOtCommand,
  SignOtNoteCommand,
  WriteOtNoteCommand,
  type OtClinicalInput,
} from './ot.messages.js';

@Injectable()
export class OtDesk {
  constructor(
    readonly ipd: IpdDesk,
    readonly cases: OtCaseRepository,
    readonly read: OtReadRepository,
  ) {}

  get opd() {
    return this.ipd.opd;
  }

  record(action: string, actor: Actor, id: string, metadata: Record<string, string | number | null> = {}) {
    return this.opd.audit.record({
      action: `hospital.ot_${action}`,
      actorUserId: actor.userId,
      resourceType: 'ot_case',
      resourceId: id,
      metadata,
    });
  }

  /** The operation, locked, at the version the caller saw. */
  async locked(id: string, version: number): Promise<OtCase> {
    const otCase = await this.cases.findForUpdate(id);
    if (!otCase) throw new NotFoundError('ot_case');
    otCase.assertVersion(version);
    return otCase;
  }

  /** The masters and doctors an operation names: they exist, and the operation and doctors are in use. */
  async checkClinical(input: OtClinicalInput): Promise<void> {
    const found = await this.cases.masters(input);
    if (!found.operation) throw new NotFoundError('operation');
    if (input.otTypeId && !found.otType) throw new NotFoundError('ot_type');
    if (input.anaesthesiaTypeId && !found.anaesthesiaType) throw new NotFoundError('anaesthesia_type');
    await this.ipd.doctors([
      input.surgeonId,
      ...(input.anaesthetistId ? [input.anaesthetistId] : []),
      ...input.team.map((member) => member.doctorId),
    ]);
  }

  /** Saves a change made to an operation and records it. */
  async save(otCase: OtCase, action: string, actor: Actor, metadata: Record<string, string | number | null> = {}) {
    await this.cases.update(otCase);
    const snapshot = otCase.toSnapshot();
    await this.record(action, actor, otCase.id, { number: snapshot.number, ...metadata });
    return { version: snapshot.version };
  }
}

/**
 * Old OTSchedule page (a free-text status, Floor and OTRoom as strings no form filled in): an operation asked for an
 * admitted patient, with the operation, surgeon, anaesthetist, the others in the team and the day it is wanted.
 */
@CommandHandler(RequestOtCommand)
export class RequestOtHandler implements ICommandHandler<RequestOtCommand> {
  constructor(private readonly desk: OtDesk) {}

  async execute({ actor, admissionId, requestedFor, input }: RequestOtCommand) {
    const { desk } = this;
    const { opd } = desk;
    await opd.access.authorize(actor.userId, { permissions: [OT_REQUEST] });
    return opd.tx.run(async () => {
      const admission = await desk.ipd.admissions.findById(admissionId);
      if (!admission) throw new NotFoundError('admission');
      const stay = admission.toSnapshot();
      if (stay.status !== 'admitted') {
        throw new DomainError('not_admitted', `The patient is ${stay.status}: no operation is asked for`);
      }
      if (requestedFor < opd.today()) throw new DomainError('invalid_date', 'The day wanted has passed');
      await desk.checkClinical(input);
      const otCase = OtCase.request({
        ...input,
        id: randomUUID(),
        number: await opd.number('OT', opd.today()),
        admissionId,
        patientId: stay.patientId,
        requestedFor,
        by: actor.userId,
        at: opd.clock.now(),
      });
      await desk.cases.insert(otCase);
      const snapshot = otCase.toSnapshot();
      await desk.record('requested', actor, otCase.id, { number: snapshot.number, admission: stay.number });
      return { id: otCase.id, number: snapshot.number };
    });
  }
}

/** Who operates and what, changed before the operation is done (the old page rewrote every field). */
@CommandHandler(ChangeOtCommand)
export class ChangeOtHandler implements ICommandHandler<ChangeOtCommand> {
  constructor(private readonly desk: OtDesk) {}

  async execute({ actor, id, version, input }: ChangeOtCommand) {
    const { desk } = this;
    await desk.opd.access.authorize(actor.userId, { permissions: [OT_REQUEST] });
    return desk.opd.tx.run(async () => {
      const otCase = await desk.locked(id, version);
      await desk.checkClinical(input);
      otCase.change(input, desk.opd.clock.now());
      return desk.save(otCase, 'changed', actor);
    });
  }
}

/**
 * Old OTRoomBookingRequest and OTRoomBook pages (the clash check ran in the browser on one room's loaded list, missed
 * a booking inside another, never checked the room against the request, and saved row by row): a room and a time for
 * the operation, taken under a lock on the room, refused when another operation in the room overlaps it.
 */
@CommandHandler(ScheduleOtCommand)
export class ScheduleOtHandler implements ICommandHandler<ScheduleOtCommand> {
  constructor(private readonly desk: OtDesk) {}

  async execute({ actor, id, version, roomId, from, to }: ScheduleOtCommand) {
    const { desk } = this;
    const { opd } = desk;
    await opd.access.authorize(actor.userId, { permissions: [OT_SCHEDULE] });
    return opd.tx.run(async () => {
      await opd.tx.lock(`hospital:ot-room:${roomId}`);
      const room = await desk.cases.room(roomId);
      if (!room) throw new NotFoundError('ot_room');
      if (!room.isActive) throw new DomainError('room_unavailable', `${room.name} is not in use`);
      const otCase = await desk.locked(id, version);
      otCase.schedule(roomId, from, to, opd.clock.now());
      const clash = await desk.cases.clash(roomId, from, to, id);
      if (clash) throw new ConflictError('room_taken', `${room.name} is booked for ${clash.number} then`);
      return desk.save(otCase, 'scheduled', actor, { room: room.name, from: from.toISOString() });
    });
  }
}

/** Old OT Management's complete toggle (which wiped the schedule's other fields): the operation started or done. */
@CommandHandler(MoveOtCommand)
export class MoveOtHandler implements ICommandHandler<MoveOtCommand> {
  constructor(private readonly desk: OtDesk) {}

  async execute({ actor, id, version, step, at }: MoveOtCommand) {
    const { desk } = this;
    const { opd } = desk;
    await opd.access.authorize(actor.userId, { permissions: [OT_SCHEDULE] });
    return opd.tx.run(async () => {
      const otCase = await desk.locked(id, version);
      const now = opd.clock.now();
      if (step === 'start') otCase.start(at ?? now, now);
      else otCase.finish(at ?? now, now);
      return desk.save(otCase, step === 'start' ? 'started' : 'done', actor);
    });
  }
}

/** The old cancel button was commented out; here an operation not under way is cancelled with a reason. */
@CommandHandler(CancelOtCommand)
export class CancelOtHandler implements ICommandHandler<CancelOtCommand> {
  constructor(private readonly desk: OtDesk) {}

  async execute({ actor, id, version, reason }: CancelOtCommand) {
    const { desk } = this;
    await desk.opd.access.authorize(actor.userId, { permissions: [OT_SCHEDULE] });
    return desk.opd.tx.run(async () => {
      const otCase = await desk.locked(id, version);
      otCase.cancel(reason, desk.opd.clock.now());
      return desk.save(otCase, 'cancelled', actor, { reason });
    });
  }
}

/** Old OT Note page (one of seven tabs, keyed by a schedule the gynae branch filled with a stay id): the note. */
@CommandHandler(WriteOtNoteCommand)
export class WriteOtNoteHandler implements ICommandHandler<WriteOtNoteCommand> {
  constructor(private readonly desk: OtDesk) {}

  async execute({ actor, id, version, note }: WriteOtNoteCommand) {
    const { desk } = this;
    await desk.opd.access.authorize(actor.userId, { permissions: [OT_NOTE] });
    return desk.opd.tx.run(async () => {
      const otCase = await desk.locked(id, version);
      otCase.writeNote(note, desk.opd.clock.now());
      return desk.save(otCase, 'note_written', actor);
    });
  }
}

/** The operation note signed, by the surgeon's own account only, once the operation is done. */
@CommandHandler(SignOtNoteCommand)
export class SignOtNoteHandler implements ICommandHandler<SignOtNoteCommand> {
  constructor(private readonly desk: OtDesk) {}

  async execute({ actor, id, version }: SignOtNoteCommand) {
    const { desk } = this;
    await desk.opd.access.authorize(actor.userId, { permissions: [OT_NOTE] });
    return desk.opd.tx.run(async () => {
      const otCase = await desk.locked(id, version);
      const surgeonId = otCase.toSnapshot().surgeonId;
      const surgeonUser = (await desk.read.doctorUsers([surgeonId])).get(surgeonId);
      if (!surgeonUser || surgeonUser !== actor.userId) {
        throw new ForbiddenError('not_the_surgeon', 'Only the surgeon signs the operation note');
      }
      otCase.signNote(actor.userId, desk.opd.clock.now());
      return desk.save(otCase, 'note_signed', actor);
    });
  }
}

@QueryHandler(ListOtCasesQuery)
export class ListOtCasesHandler implements IQueryHandler<ListOtCasesQuery> {
  constructor(private readonly desk: OtDesk) {}

  async execute({ actor, filter }: ListOtCasesQuery) {
    await this.desk.opd.access.authorize(actor.userId, { permissions: [OT_READ] });
    return this.desk.read.list(filter);
  }
}

@QueryHandler(GetOtCaseQuery)
export class GetOtCaseHandler implements IQueryHandler<GetOtCaseQuery> {
  constructor(private readonly desk: OtDesk) {}

  async execute({ actor, id }: GetOtCaseQuery) {
    await this.desk.opd.access.authorize(actor.userId, { permissions: [OT_READ] });
    const found = await this.desk.read.get(id);
    if (!found) throw new NotFoundError('ot_case');
    return found;
  }
}

/** Old OT Management's schedule tab and the room booking calendar: each room's day, and what waits for a room. */
@QueryHandler(OtBoardQuery)
export class OtBoardHandler implements IQueryHandler<OtBoardQuery> {
  constructor(private readonly desk: OtDesk) {}

  async execute({ actor, day }: OtBoardQuery) {
    const { desk } = this;
    await desk.opd.access.authorize(actor.userId, { permissions: [OT_READ] });
    const [from, to] = dayBounds(day, desk.opd.settings.timeZone);
    return desk.read.board(day, from, to);
  }
}

export const OT_HANDLERS = [
  OtDesk,
  RequestOtHandler,
  ChangeOtHandler,
  ScheduleOtHandler,
  MoveOtHandler,
  CancelOtHandler,
  WriteOtNoteHandler,
  SignOtNoteHandler,
  ListOtCasesHandler,
  GetOtCaseHandler,
  OtBoardHandler,
];
