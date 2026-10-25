import { randomUUID } from 'node:crypto';
import { Inject } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import type { Page } from '../../../shared/application/pagination.js';
import { AuditTrail } from '../../../shared/application/ports/audit-trail.js';
import { Clock } from '../../../shared/application/ports/clock.js';
import { TransactionManager } from '../../../shared/application/ports/transaction-manager.js';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../shared/domain/errors.js';
import {
  ManualAttendance,
  manualDayErrors,
  manualDayWarnings,
  type AttendanceActor,
  type ManualDayContext,
} from '../domain/attendance.js';
import { AttendanceRepository, StaffFacts } from '../domain/repositories.js';
import { addDays, zonedInstant } from '../domain/roster.js';
import { isCalendarDate } from '../domain/staff-member.js';
import {
  ActOnManualAttendanceCommand,
  CreateManualAttendanceCommand,
  GetDailyAttendanceQuery,
  GetManualAttendanceContextQuery,
  GetManualAttendanceQuery,
  GetStaffAttendanceQuery,
  IngestPunchesCommand,
  ListManualAttendanceQuery,
  ListPunchesQuery,
  type ManualAction,
  type ManualContextView,
  type PunchIngestResult,
} from './attendance.messages.js';
import {
  AttendanceReadRepository,
  computeAttendance,
  localToday,
  type ManualAttendanceView,
  type StaffAttendanceRow,
} from './attendance.read-models.js';
import { ATTENDANCE_APPROVE, ATTENDANCE_ENTER, ATTENDANCE_INGEST, ATTENDANCE_READ } from './hr.constants.js';
import { HR_SETTINGS, type HrSettings } from './roster.handlers.js';

const AUDIT_ACTIONS: Record<ManualAction, string> = {
  edit: 'edited',
  submit: 'submitted',
  approve: 'approved',
  reject: 'rejected',
  cancel: 'cancelled',
};

export const MAX_PUNCHES = 5000;
export const MAX_ATTENDANCE_DAYS = 62;

function assertRange(from: string, to: string): void {
  if (!isCalendarDate(from) || !isCalendarDate(to) || to < from) throw new ValidationError('Give a valid date range');
  if (to > addDays(from, MAX_ATTENDANCE_DAYS - 1)) {
    throw new ValidationError(`The range can be at most ${MAX_ATTENDANCE_DAYS} days`);
  }
}

/** Own staff record, or attendance:read for anyone else's. */
async function authorizeStaffRead(
  access: AccessControl,
  staff: StaffFacts,
  actor: Actor,
  staffId: string | undefined,
): Promise<string> {
  const own = await staff.staffIdForUser(actor.userId);
  const target = staffId ?? own;
  if (!target) throw new NotFoundError('staff');
  if (target !== own) await access.authorize(actor.userId, { permissions: [ATTENDANCE_READ] });
  return target;
}

@CommandHandler(IngestPunchesCommand)
export class IngestPunchesHandler implements ICommandHandler<IngestPunchesCommand> {
  constructor(
    private readonly attendance: AttendanceRepository,
    private readonly access: AccessControl,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async execute({ actor, punches }: IngestPunchesCommand): Promise<PunchIngestResult> {
    await this.access.authorize(actor.userId, { permissions: [ATTENDANCE_INGEST] });
    if (punches.length === 0 || punches.length > MAX_PUNCHES)
      throw new ValidationError(`Send 1 to ${MAX_PUNCHES} punches`);
    const now = this.clock.now();
    if (punches.some((punch) => punch.punchedAt.getTime() > now.getTime() + 5 * 60_000)) {
      throw new DomainError('punch_in_future', 'A punch is in the future; check the device clock and time zone');
    }
    return this.tx.run(async () => {
      const numbers = [...new Set(punches.map((punch) => punch.biometricNo))];
      const owners = await this.attendance.staffByBiometric(numbers);
      const accepted = await this.attendance.insertPunches(
        punches.map((punch) => ({ id: randomUUID(), ...punch, staffId: owners.get(punch.biometricNo) ?? null })),
        actor.userId,
        now,
      );
      await this.audit.record({
        action: 'attendance.punches_received',
        actorUserId: actor.userId,
        resourceType: 'attendance',
        metadata: { received: punches.length, accepted },
      });
      return {
        received: punches.length,
        accepted,
        duplicates: punches.length - accepted,
        unmatchedBiometricNos: numbers.filter((number) => !owners.has(number)).sort((a, b) => a - b),
      };
    });
  }
}

@QueryHandler(GetDailyAttendanceQuery)
export class GetDailyAttendanceHandler implements IQueryHandler<GetDailyAttendanceQuery> {
  constructor(
    private readonly read: AttendanceReadRepository,
    private readonly access: AccessControl,
    @Inject(HR_SETTINGS) private readonly settings: HrSettings,
  ) {}

  async execute({ actor, date, scope }: GetDailyAttendanceQuery): Promise<StaffAttendanceRow[]> {
    await this.access.authorize(actor.userId, { permissions: [ATTENDANCE_READ] });
    if (!isCalendarDate(date)) throw new ValidationError('Give a valid date');
    const facts = await this.read.facts(scope, date, date, this.settings.timeZone);
    return computeAttendance(facts, date, date, this.settings.timeZone);
  }
}

@QueryHandler(GetStaffAttendanceQuery)
export class GetStaffAttendanceHandler implements IQueryHandler<GetStaffAttendanceQuery> {
  constructor(
    private readonly read: AttendanceReadRepository,
    private readonly staff: StaffFacts,
    private readonly access: AccessControl,
    @Inject(HR_SETTINGS) private readonly settings: HrSettings,
  ) {}

  async execute({ actor, from, to, staffId }: GetStaffAttendanceQuery): Promise<StaffAttendanceRow[]> {
    assertRange(from, to);
    const target = await authorizeStaffRead(this.access, this.staff, actor, staffId);
    const facts = await this.read.facts({ staffIds: [target] }, from, to, this.settings.timeZone);
    if (facts.staff.length === 0) throw new NotFoundError('staff');
    return computeAttendance(facts, from, to, this.settings.timeZone);
  }
}

@QueryHandler(ListPunchesQuery)
export class ListPunchesHandler implements IQueryHandler<ListPunchesQuery> {
  constructor(
    private readonly read: AttendanceReadRepository,
    private readonly staff: StaffFacts,
    private readonly access: AccessControl,
    @Inject(HR_SETTINGS) private readonly settings: HrSettings,
  ) {}

  async execute({ actor, staffId, from, to }: ListPunchesQuery) {
    assertRange(from, to);
    await authorizeStaffRead(this.access, this.staff, actor, staffId);
    return this.read.punches(
      staffId,
      zonedInstant(from, '00:00', this.settings.timeZone),
      zonedInstant(addDays(to, 1), '00:00', this.settings.timeZone),
    );
  }
}

/** Shared by the manual-attendance commands: who is acting and what the day looks like. */
abstract class ManualAttendanceHandler {
  constructor(
    protected readonly attendance: AttendanceRepository,
    protected readonly staff: StaffFacts,
    protected readonly access: AccessControl,
    protected readonly tx: TransactionManager,
    protected readonly audit: AuditTrail,
    protected readonly clock: Clock,
    protected readonly settings: HrSettings,
  ) {}

  protected async actorOf(actor: Actor): Promise<AttendanceActor> {
    const [staffId, canEnter, canApprove] = await Promise.all([
      this.staff.staffIdForUser(actor.userId),
      this.access.isAllowed(actor.userId, { permissions: [ATTENDANCE_ENTER] }),
      this.access.isAllowed(actor.userId, { permissions: [ATTENDANCE_APPROVE] }),
    ]);
    return { userId: actor.userId, staffId, canEnter, canApprove };
  }

  /** Old DayErrorsAsync: re-checked when an entry is created, submitted and approved. */
  protected async assertDayAllowed(staffId: string, date: string, excludeId: string | null): Promise<void> {
    const context = await this.attendance.manualContext(staffId, date, excludeId);
    if (!context) throw new NotFoundError('staff');
    const errors = manualDayErrors({
      ...context,
      hasPunches: false,
      isFuture: date > localToday(this.clock.now(), this.settings.timeZone),
    });
    if (errors.length > 0) throw new DomainError('manual_attendance_not_allowed', errors.join('; '));
  }
}

@CommandHandler(CreateManualAttendanceCommand)
export class CreateManualAttendanceHandler
  extends ManualAttendanceHandler
  implements ICommandHandler<CreateManualAttendanceCommand>
{
  constructor(
    attendance: AttendanceRepository,
    staff: StaffFacts,
    access: AccessControl,
    tx: TransactionManager,
    audit: AuditTrail,
    clock: Clock,
    @Inject(HR_SETTINGS) settings: HrSettings,
  ) {
    super(attendance, staff, access, tx, audit, clock, settings);
  }

  async execute({ actor, staffId, date, times, submit }: CreateManualAttendanceCommand): Promise<{ id: string }> {
    if (!isCalendarDate(date)) throw new ValidationError('Give a valid date');
    const who = await this.actorOf(actor);
    const now = this.clock.now();
    const entry = ManualAttendance.create({ id: randomUUID(), staffId, attendanceDate: date, times, actor: who, now });
    await this.tx.run(async () => {
      await this.tx.lock(`hr:manual-attendance:${staffId}`);
      await this.assertDayAllowed(staffId, date, null);
      if (submit) entry.submit(who, now);
      await this.attendance.insertManual(entry);
      await this.audit.record({
        action: submit ? 'manual_attendance.submitted' : 'manual_attendance.created',
        actorUserId: actor.userId,
        resourceType: 'manual_attendance',
        resourceId: entry.id,
        metadata: { staffId, date },
      });
    });
    return { id: entry.id };
  }
}

@CommandHandler(ActOnManualAttendanceCommand)
export class ActOnManualAttendanceHandler
  extends ManualAttendanceHandler
  implements ICommandHandler<ActOnManualAttendanceCommand>
{
  constructor(
    attendance: AttendanceRepository,
    staff: StaffFacts,
    access: AccessControl,
    tx: TransactionManager,
    audit: AuditTrail,
    clock: Clock,
    @Inject(HR_SETTINGS) settings: HrSettings,
  ) {
    super(attendance, staff, access, tx, audit, clock, settings);
  }

  async execute({ actor, id, action, version, remarks, times }: ActOnManualAttendanceCommand): Promise<void> {
    const who = await this.actorOf(actor);
    await this.tx.run(async () => {
      const entry = await this.attendance.findManualForUpdate(id);
      if (!entry) throw new NotFoundError('manual_attendance');
      const before = entry.toSnapshot();
      if (before.version !== version) {
        throw new ConflictError(
          'stale_manual_attendance',
          `This entry was changed by someone else (it is now ${before.status}); reload and try again`,
        );
      }
      const now = this.clock.now();
      switch (action) {
        case 'edit':
          entry.edit(times ?? {}, who, now);
          break;
        case 'submit':
          entry.submit(who, now);
          await this.assertDayAllowed(entry.staffId, entry.attendanceDate, entry.id);
          break;
        case 'approve':
          entry.approve(who, remarks, now);
          await this.assertDayAllowed(entry.staffId, entry.attendanceDate, entry.id);
          break;
        case 'reject':
          entry.reject(who, remarks, now);
          break;
        case 'cancel':
          entry.cancel(who, remarks, now);
          break;
      }
      await this.attendance.updateManual(entry);
      const after = entry.toSnapshot();
      await this.audit.record({
        action: `manual_attendance.${AUDIT_ACTIONS[action]}`,
        actorUserId: actor.userId,
        resourceType: 'manual_attendance',
        resourceId: id,
        metadata: {
          from: before.status,
          to: after.status,
          inTime: after.inTime,
          outTime: after.outTime,
          ...(after.decisionRemarks ? { remarks: after.decisionRemarks } : {}),
        },
      });
    });
  }
}

@QueryHandler(ListManualAttendanceQuery)
export class ListManualAttendanceHandler implements IQueryHandler<ListManualAttendanceQuery> {
  constructor(
    private readonly read: AttendanceReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, filter }: ListManualAttendanceQuery): Promise<Page<ManualAttendanceView>> {
    await this.access.authorize(actor.userId, {
      permissions: [ATTENDANCE_READ, ATTENDANCE_ENTER, ATTENDANCE_APPROVE],
      mode: 'any',
    });
    return this.read.listManual(filter);
  }
}

@QueryHandler(GetManualAttendanceQuery)
export class GetManualAttendanceHandler implements IQueryHandler<GetManualAttendanceQuery> {
  constructor(
    private readonly read: AttendanceReadRepository,
    private readonly staff: StaffFacts,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, id }: GetManualAttendanceQuery): Promise<ManualAttendanceView> {
    const [entry, own, allowed] = await Promise.all([
      this.read.getManual(id),
      this.staff.staffIdForUser(actor.userId),
      this.access.isAllowed(actor.userId, {
        permissions: [ATTENDANCE_READ, ATTENDANCE_ENTER, ATTENDANCE_APPROVE],
        mode: 'any',
      }),
    ]);
    if (!allowed && !(entry && own !== null && entry.staffId === own)) throw new ForbiddenError();
    if (!entry) throw new NotFoundError('manual_attendance');
    return entry;
  }
}

@QueryHandler(GetManualAttendanceContextQuery)
export class GetManualAttendanceContextHandler implements IQueryHandler<GetManualAttendanceContextQuery> {
  constructor(
    private readonly attendance: AttendanceRepository,
    private readonly read: AttendanceReadRepository,
    private readonly access: AccessControl,
    private readonly clock: Clock,
    @Inject(HR_SETTINGS) private readonly settings: HrSettings,
  ) {}

  async execute({
    actor,
    staffId,
    date,
    times,
    excludeId,
  }: GetManualAttendanceContextQuery): Promise<ManualContextView> {
    await this.access.authorize(actor.userId, { permissions: [ATTENDANCE_ENTER, ATTENDANCE_APPROVE], mode: 'any' });
    if (!isCalendarDate(date)) throw new ValidationError('Give a valid date');
    const facts = await this.attendance.manualContext(staffId, date, excludeId ?? null);
    if (!facts) throw new NotFoundError('staff');
    const timeZone = this.settings.timeZone;
    const dayFacts = await this.read.facts({ staffIds: [staffId] }, date, date, timeZone);
    const [withoutEntry] = computeAttendance({ ...dayFacts, manual: [] }, date, date, timeZone);
    const context: ManualDayContext = {
      ...facts,
      hasPunches: withoutEntry?.source === 'device',
      isFuture: date > localToday(this.clock.now(), timeZone),
    };
    const manual = times.inTime || times.outTime ? [{ staffId, date, ...times }] : dayFacts.manual;
    const [preview] = computeAttendance({ ...dayFacts, manual }, date, date, timeZone);
    return { errors: manualDayErrors(context), warnings: manualDayWarnings(context), preview: preview?.status ?? null };
  }
}

export const ATTENDANCE_HANDLERS = [
  IngestPunchesHandler,
  GetDailyAttendanceHandler,
  GetStaffAttendanceHandler,
  ListPunchesHandler,
  CreateManualAttendanceHandler,
  ActOnManualAttendanceHandler,
  ListManualAttendanceHandler,
  GetManualAttendanceHandler,
  GetManualAttendanceContextHandler,
];
