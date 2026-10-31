import { Inject, Injectable } from '@nestjs/common';
import { aliasedTable, and, asc, count, desc, eq, gt, inArray, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { offsetOf, toPage, type Page } from '../../../../shared/application/pagination.js';
import { UserDirectory } from '../../../../shared/application/contracts/user-directory.js';
import {
  OtReadRepository,
  type OtBoard,
  type OtCaseFilter,
  type OtCaseSummary,
  type OtCaseView,
} from '../../application/ot.messages.js';
import { HOSPITAL_SETTINGS, type HospitalSettings } from '../../application/patient.handlers.js';
import { OtCase } from '../../domain/ot-case.js';
import { OtCaseRepository, type OtRoom } from '../../domain/repositories.js';
import {
  admissions,
  anaesthesiaTypes,
  doctors,
  ipdCharges,
  operations,
  otCases,
  otRooms,
  otTeam,
  otTypes,
  patients,
  services,
} from './hospital.schema.js';

/** Booked: an operation that holds its room (scheduled, or under way). */
const holdsRoom = inArray(otCases.status, ['scheduled', 'in_progress']);

@Injectable()
export class DrizzleOtCaseRepository extends OtCaseRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  findById(id: string): Promise<OtCase | null> {
    return this.load(id, false);
  }

  findForUpdate(id: string): Promise<OtCase | null> {
    return this.load(id, true);
  }

  private async load(id: string, lock: boolean): Promise<OtCase | null> {
    const query = this.context.db.select().from(otCases).where(eq(otCases.id, id));
    const [row] = lock ? await query.for('update') : await query;
    if (!row) return null;
    const team = await this.context.db
      .select({ doctorId: otTeam.doctorId, role: otTeam.role })
      .from(otTeam)
      .where(eq(otTeam.caseId, id))
      .orderBy(asc(otTeam.role), asc(otTeam.doctorId));
    return OtCase.restore({ ...row, team });
  }

  async insert(otCase: OtCase): Promise<void> {
    const { team, ...row } = otCase.toSnapshot();
    await this.context.db.insert(otCases).values(row);
    await this.saveTeam(otCase.id, team);
  }

  async update(otCase: OtCase): Promise<void> {
    const { team, id, createdAt: _created, ...row } = otCase.toSnapshot();
    await this.context.db.update(otCases).set(row).where(eq(otCases.id, id));
    await this.context.db.delete(otTeam).where(eq(otTeam.caseId, id));
    await this.saveTeam(id, team);
  }

  private async saveTeam(caseId: string, team: ReturnType<OtCase['toSnapshot']>['team']): Promise<void> {
    if (team.length) await this.context.db.insert(otTeam).values(team.map((member) => ({ caseId, ...member })));
  }

  async room(id: string): Promise<OtRoom | null> {
    const [row] = await this.context.db
      .select({ id: otRooms.id, name: otRooms.name, isActive: otRooms.isActive })
      .from(otRooms)
      .where(eq(otRooms.id, id));
    return row ?? null;
  }

  async clash(roomId: string, from: Date, to: Date, exceptId: string): Promise<{ number: string } | null> {
    const [row] = await this.context.db
      .select({ number: otCases.number })
      .from(otCases)
      .where(
        and(
          eq(otCases.otRoomId, roomId),
          holdsRoom,
          ne(otCases.id, exceptId),
          lt(otCases.scheduledFrom, to),
          gt(otCases.scheduledTo, from),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async masters(ids: { operationId: string; otTypeId: string | null; anaesthesiaTypeId: string | null }) {
    const [operation] = await this.context.db
      .select({ id: operations.id })
      .from(operations)
      .where(and(eq(operations.id, ids.operationId), eq(operations.isActive, true)));
    const [otType] = ids.otTypeId
      ? await this.context.db.select({ id: otTypes.id }).from(otTypes).where(eq(otTypes.id, ids.otTypeId))
      : [];
    const [anaesthesia] = ids.anaesthesiaTypeId
      ? await this.context.db
          .select({ id: anaesthesiaTypes.id })
          .from(anaesthesiaTypes)
          .where(eq(anaesthesiaTypes.id, ids.anaesthesiaTypeId))
      : [];
    return { operation: Boolean(operation), otType: Boolean(otType), anaesthesiaType: Boolean(anaesthesia) };
  }
}

const surgeon = aliasedTable(doctors, 'surgeon');
const anaesthetist = aliasedTable(doctors, 'anaesthetist');

@Injectable()
export class DrizzleOtReadRepository extends OtReadRepository {
  constructor(
    private readonly context: DbContext,
    @Inject(HOSPITAL_SETTINGS) private readonly settings: HospitalSettings,
    private readonly users: UserDirectory,
  ) {
    super();
  }

  private summaries() {
    return this.context.db
      .select({
        id: otCases.id,
        number: otCases.number,
        status: otCases.status,
        admissionId: otCases.admissionId,
        admissionNumber: admissions.number,
        patientId: otCases.patientId,
        uhid: patients.uhid,
        patientName: patients.fullName,
        operationName: operations.name,
        surgeonName: surgeon.name,
        requestedFor: otCases.requestedFor,
        otRoomId: otCases.otRoomId,
        otRoomName: otRooms.name,
        scheduledFrom: otCases.scheduledFrom,
        scheduledTo: otCases.scheduledTo,
      })
      .from(otCases)
      .innerJoin(admissions, eq(admissions.id, otCases.admissionId))
      .innerJoin(patients, eq(patients.id, otCases.patientId))
      .innerJoin(operations, eq(operations.id, otCases.operationId))
      .innerJoin(surgeon, eq(surgeon.id, otCases.surgeonId))
      .leftJoin(otRooms, eq(otRooms.id, otCases.otRoomId));
  }

  async list(filter: OtCaseFilter): Promise<Page<OtCaseSummary>> {
    // The day an operation is on: its booked day when it has one, else the day it is wanted.
    const onDay = sql`coalesce((${otCases.scheduledFrom} at time zone ${this.settings.timeZone})::date, ${otCases.requestedFor})`;
    const where = and(
      filter.status ? eq(otCases.status, filter.status) : undefined,
      filter.roomId ? eq(otCases.otRoomId, filter.roomId) : undefined,
      filter.surgeonId ? eq(otCases.surgeonId, filter.surgeonId) : undefined,
      filter.admissionId ? eq(otCases.admissionId, filter.admissionId) : undefined,
      filter.from ? sql`${onDay} >= ${filter.from}` : undefined,
      filter.to ? sql`${onDay} <= ${filter.to}` : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.summaries()
        .where(where)
        .orderBy(desc(otCases.requestedFor), desc(otCases.number))
        .limit(filter.pageSize)
        .offset(offsetOf(filter)),
      this.context.db.select({ n: count() }).from(otCases).where(where),
    ]);
    return toPage(rows, total?.n ?? 0, filter);
  }

  async get(id: string): Promise<OtCaseView | null> {
    const [header] = await this.summaries().where(eq(otCases.id, id));
    if (!header) return null;
    const [row] = await this.context.db
      .select({
        operationId: otCases.operationId,
        otTypeId: otCases.otTypeId,
        otTypeName: otTypes.name,
        anaesthesiaTypeId: otCases.anaesthesiaTypeId,
        anaesthesiaTypeName: anaesthesiaTypes.name,
        surgeonId: otCases.surgeonId,
        anaesthetistId: otCases.anaesthetistId,
        anaesthetistName: anaesthetist.name,
        indication: otCases.indication,
        startedAt: otCases.startedAt,
        endedAt: otCases.endedAt,
        cancelReason: otCases.cancelReason,
        incision: otCases.incision,
        findings: otCases.findings,
        procedureDone: otCases.procedureDone,
        specimen: otCases.specimen,
        postOpOrders: otCases.postOpOrders,
        noteSignedAt: otCases.noteSignedAt,
        noteSignedBy: otCases.noteSignedBy,
        version: otCases.version,
      })
      .from(otCases)
      .leftJoin(otTypes, eq(otTypes.id, otCases.otTypeId))
      .leftJoin(anaesthesiaTypes, eq(anaesthesiaTypes.id, otCases.anaesthesiaTypeId))
      .leftJoin(anaesthetist, eq(anaesthetist.id, otCases.anaesthetistId))
      .where(eq(otCases.id, id));
    const team = await this.context.db
      .select({ doctorId: otTeam.doctorId, doctorName: doctors.name, role: otTeam.role })
      .from(otTeam)
      .innerJoin(doctors, eq(doctors.id, otTeam.doctorId))
      .where(eq(otTeam.caseId, id))
      .orderBy(asc(otTeam.role), asc(doctors.name));
    const charges = await this.context.db
      .select({
        id: ipdCharges.id,
        serviceName: services.name,
        doctorName: doctors.name,
        qty: ipdCharges.qty,
        rate: ipdCharges.rate,
        amount: ipdCharges.amount,
        status: ipdCharges.status,
      })
      .from(ipdCharges)
      .innerJoin(services, eq(services.id, ipdCharges.serviceId))
      .leftJoin(doctors, eq(doctors.id, ipdCharges.doctorId))
      .where(eq(ipdCharges.otCaseId, id))
      .orderBy(asc(ipdCharges.createdAt));
    const chargedTotal =
      charges
        .filter((charge) => charge.status === 'active')
        .reduce((sum, charge) => sum + Math.round(charge.amount * 100), 0) / 100;
    const { noteSignedBy, ...rest } = row!;
    const [signer] = noteSignedBy ? await this.users.findSummaries([noteSignedBy]) : [];
    return { ...header, ...rest, noteSignedByName: signer?.displayName ?? null, team, charges, chargedTotal };
  }

  async board(day: string, from: Date, to: Date): Promise<OtBoard> {
    const rooms = await this.context.db
      .select({ id: otRooms.id, name: otRooms.name, floor: otRooms.floor })
      .from(otRooms)
      .where(eq(otRooms.isActive, true))
      .orderBy(asc(otRooms.name));
    const booked = await this.summaries()
      .where(
        and(
          inArray(otCases.status, ['scheduled', 'in_progress', 'done']),
          lt(otCases.scheduledFrom, to),
          gt(otCases.scheduledTo, from),
        ),
      )
      .orderBy(asc(otCases.scheduledFrom));
    const waiting = await this.summaries()
      .where(and(eq(otCases.status, 'requested'), lte(otCases.requestedFor, day), isNull(otCases.otRoomId)))
      .orderBy(asc(otCases.requestedFor), asc(otCases.number));
    return {
      day,
      rooms: rooms.map((room) => ({ ...room, cases: booked.filter((entry) => entry.otRoomId === room.id) })),
      waiting,
    };
  }

  async doctorUsers(ids: readonly string[]): Promise<Map<string, string | null>> {
    if (ids.length === 0) return new Map();
    const rows = await this.context.db
      .select({ id: doctors.id, userId: doctors.userId })
      .from(doctors)
      .where(or(...ids.map((id) => eq(doctors.id, id))));
    return new Map(rows.map((row) => [row.id, row.userId]));
  }
}
