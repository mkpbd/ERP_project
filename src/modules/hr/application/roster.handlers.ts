import { randomUUID } from 'node:crypto';
import { Inject } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import { AuditTrail } from '../../../shared/application/ports/audit-trail.js';
import { Clock } from '../../../shared/application/ports/clock.js';
import { TransactionManager } from '../../../shared/application/ports/transaction-manager.js';
import { DomainError, NotFoundError, ValidationError } from '../../../shared/domain/errors.js';
import { RosterRepository, StaffFacts, type DayOff, type RosterWrites } from '../domain/repositories.js';
import { addDays, planHasChanges, planRosterDay, type Duty, type RosterScope } from '../domain/roster.js';
import { isCalendarDate } from '../domain/staff-member.js';
import { ROSTER_MANAGE } from './hr.constants.js';
import {
  GetMyRosterQuery,
  GetRosterMonthQuery,
  SaveRosterEntriesCommand,
  type RosterDayView,
  type RosterEntryResult,
  type RosterMonthRef,
  type RosterMonthView,
} from './roster.messages.js';
import { cellVersion, dayView, dayViews, RosterReadRepository } from './roster.read-models.js';

export interface HrSettings {
  /** The organization's local time zone: shift times and roster dates are wall-clock times there. */
  readonly timeZone: string;
}

export const HR_SETTINGS = Symbol('HR_SETTINGS');

export const MAX_ROSTER_ENTRIES = 2000;

function monthRange(month: RosterMonthRef): { firstDay: string; lastDay: string } {
  if (!Number.isInteger(month.year) || month.year < 2000 || month.year > 2100 || month.month < 1 || month.month > 12) {
    throw new DomainError('invalid_month', 'Invalid month');
  }
  const firstDay = `${month.year}-${String(month.month).padStart(2, '0')}-01`;
  const next =
    month.month === 12 ? `${month.year + 1}-01-01` : `${month.year}-${String(month.month + 1).padStart(2, '0')}-01`;
  return { firstDay, lastDay: addDays(next, -1) };
}

@QueryHandler(GetRosterMonthQuery)
export class GetRosterMonthHandler implements IQueryHandler<GetRosterMonthQuery> {
  constructor(
    private readonly read: RosterReadRepository,
    private readonly roster: RosterRepository,
  ) {}

  async execute({ month }: GetRosterMonthQuery): Promise<RosterMonthView> {
    const { firstDay, lastDay } = monthRange(month);
    const [staff, shiftTypes, govtHolidays] = await Promise.all([
      this.read.staff(month.departmentId, month.subDepartmentId, firstDay, lastDay),
      this.read.shiftTypes(month.departmentId),
      this.read.govtHolidays(firstDay, lastDay),
    ]);
    const ids = staff.map((member) => member.id);
    const [duties, daysOff] = await Promise.all([
      this.roster.duties(ids, firstDay, lastDay),
      this.roster.daysOff(ids, firstDay, lastDay),
    ]);
    return { ...month, staff, shiftTypes, days: dayViews(duties, daysOff), govtHolidays };
  }
}

@CommandHandler(SaveRosterEntriesCommand)
export class SaveRosterEntriesHandler implements ICommandHandler<SaveRosterEntriesCommand> {
  constructor(
    private readonly roster: RosterRepository,
    private readonly access: AccessControl,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
    @Inject(HR_SETTINGS) private readonly settings: HrSettings,
  ) {}

  async execute({ actor, month, entries }: SaveRosterEntriesCommand) {
    await this.access.authorize(actor.userId, { permissions: [ROSTER_MANAGE] });
    const { firstDay, lastDay } = monthRange(month);
    if (entries.length === 0 || entries.length > MAX_ROSTER_ENTRIES) {
      throw new ValidationError(`Send 1 to ${MAX_ROSTER_ENTRIES} roster entries`);
    }
    for (const entry of entries) {
      if (!isCalendarDate(entry.date)) throw new ValidationError(`'${entry.date}' is not a date`);
    }
    // The last entry for a cell wins, as in the old grid.
    const byCell = new Map(entries.map((entry) => [`${entry.staffId}|${entry.date}`, entry]));
    const ordered = [...byCell.values()].sort(
      (a, b) => a.staffId.localeCompare(b.staffId) || a.date.localeCompare(b.date),
    );
    const staffIds = [...new Set(ordered.map((entry) => entry.staffId))].sort();
    const scope: RosterScope = {
      departmentId: month.departmentId,
      subDepartmentId: month.subDepartmentId,
      firstDay,
      lastDay,
    };

    return this.tx.run(async () => {
      // Sorted, so concurrent saves lock people in the same order and cannot deadlock.
      for (const staffId of staffIds) await this.tx.lock(`hr:roster:${staffId}`);
      const now = this.clock.now();
      const [types, placements, duties, daysOff] = await Promise.all([
        this.roster.shiftTypes(month.departmentId),
        this.roster.placements(staffIds),
        // One day either side: an overnight shift can overlap the next or previous month.
        this.roster.duties(staffIds, addDays(firstDay, -1), addDays(lastDay, 1)),
        this.roster.daysOff(staffIds, firstDay, lastDay),
      ]);
      const shiftTypes = new Map(types.map((type) => [type.id, type]));
      const writes = { inserts: [], remarkUpdates: [], deletes: [], daysOffSet: [], daysOffCleared: [] } as {
        -readonly [K in keyof RosterWrites]: Array<RosterWrites[K][number]>;
      };
      const results: RosterEntryResult[] = [];
      const offFor = (staffId: string, date: string) =>
        daysOff.find((off) => off.staffId === staffId && off.date === date) ?? null;

      for (const entry of ordered) {
        const sameCell = (duty: Duty) => duty.staffId === entry.staffId && duty.dutyDate === entry.date;
        const current = { duties: duties.filter(sameCell), dayOff: offFor(entry.staffId, entry.date) };
        const view = () => dayView(entry.staffId, entry.date, duties, offFor(entry.staffId, entry.date));
        if (entry.expectedVersion !== cellVersion(current.duties, current.dayOff)) {
          results.push({
            staffId: entry.staffId,
            date: entry.date,
            status: 'conflict',
            errors: ['Changed by someone else since you loaded it; reload to see the saved version'],
            current: view(),
          });
          continue;
        }
        const outcome = planRosterDay({
          entry,
          current,
          staff: placements.get(entry.staffId) ?? null,
          scope,
          shiftTypes,
          otherDuties: duties.filter((duty) => duty.staffId === entry.staffId && !sameCell(duty)),
          timeZone: this.settings.timeZone,
        });
        if ('errors' in outcome) {
          results.push({
            staffId: entry.staffId,
            date: entry.date,
            status: 'invalid',
            errors: outcome.errors,
            current: view(),
          });
          continue;
        }
        const { plan } = outcome;
        if (!planHasChanges(plan)) {
          results.push({ staffId: entry.staffId, date: entry.date, status: 'unchanged', errors: [], current: view() });
          continue;
        }
        // Apply to the working set too, so later entries for the same person see these changes.
        for (const id of plan.deletes)
          duties.splice(
            duties.findIndex((duty) => duty.id === id),
            1,
          );
        for (const update of plan.remarkUpdates) duties.find((duty) => duty.id === update.id)!.remarks = update.remarks;
        for (const insert of plan.inserts) {
          const duty = { ...insert, id: randomUUID() };
          duties.push(duty);
          writes.inserts.push({ ...duty, departmentId: scope.departmentId, subDepartmentId: scope.subDepartmentId });
        }
        writes.remarkUpdates.push(...plan.remarkUpdates);
        writes.deletes.push(...plan.deletes);
        if (plan.dayOff === 'set') {
          const off: DayOff = { staffId: entry.staffId, date: entry.date, remarks: plan.dayOffRemarks };
          const index = daysOff.findIndex((existing) => existing.staffId === off.staffId && existing.date === off.date);
          if (index >= 0) daysOff.splice(index, 1, off);
          else daysOff.push(off);
          writes.daysOffSet.push(off);
        } else if (plan.dayOff === 'clear') {
          daysOff.splice(
            daysOff.findIndex((off) => off.staffId === entry.staffId && off.date === entry.date),
            1,
          );
          writes.daysOffCleared.push({ staffId: entry.staffId, date: entry.date });
        }
        results.push({ staffId: entry.staffId, date: entry.date, status: 'saved', errors: [], current: view() });
      }

      const saved = results.filter((result) => result.status === 'saved').length;
      if (saved > 0) {
        await this.roster.apply(writes, actor.userId, now);
        await this.audit.record({
          action: 'roster.saved',
          actorUserId: actor.userId,
          resourceType: 'hr_sub_department',
          resourceId: month.subDepartmentId,
          metadata: { month: firstDay.slice(0, 7), saved, staff: staffIds.length },
        });
      }
      const failed = results.filter((result) => result.status === 'invalid' || result.status === 'conflict').length;
      return { results, saved, failed };
    });
  }
}

@QueryHandler(GetMyRosterQuery)
export class GetMyRosterHandler implements IQueryHandler<GetMyRosterQuery> {
  constructor(
    private readonly roster: RosterRepository,
    private readonly staff: StaffFacts,
  ) {}

  async execute({ actor, from, to }: GetMyRosterQuery): Promise<RosterDayView[]> {
    if (!isCalendarDate(from) || !isCalendarDate(to) || to < from) throw new ValidationError('Give a valid date range');
    if (to > addDays(from, 92)) throw new ValidationError('The range can be at most 93 days');
    const staffId = await this.staff.staffIdForUser(actor.userId);
    if (!staffId) throw new NotFoundError('staff');
    const [duties, daysOff] = await Promise.all([
      this.roster.duties([staffId], from, to),
      this.roster.daysOff([staffId], from, to),
    ]);
    return dayViews(duties, daysOff);
  }
}

export const ROSTER_HANDLERS = [GetRosterMonthHandler, SaveRosterEntriesHandler, GetMyRosterHandler];
