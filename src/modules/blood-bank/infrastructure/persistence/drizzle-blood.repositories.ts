import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, ilike, inArray, or, sql } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { InpatientBlood, type BloodCharge } from '../../../../shared/application/contracts/inpatient-blood.js';
import { offsetOf, toPage, type Page } from '../../../../shared/application/pagination.js';
import { escapeLike } from '../../../../shared/infrastructure/persistence/pg-errors.js';
import {
  BloodReadRepository,
  type DonationView,
  type DonorFilter,
  type DonorSummary,
  type IssueRecord,
  type RequestFilter,
  type RequestSummary,
  type RequestView,
  type UnitFilter,
  type UnitSummary,
} from '../../application/blood.messages.js';
import { BloodRequest, BloodUnit, Donation } from '../../domain/blood.js';
import { BloodRepository, type ComponentType, type Donor } from '../../domain/repositories.js';
import {
  bloodIssues,
  bloodRequests,
  bloodSequences,
  bloodUnits,
  componentTypes,
  crossmatches,
  donations,
  donors,
} from './blood-bank.schema.js';

@Injectable()
export class DrizzleBloodRepository extends BloodRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async nextSerial(kind: string, year: number): Promise<number> {
    const [row] = await this.context.db
      .insert(bloodSequences)
      .values({ kind, year, last: 1 })
      .onConflictDoUpdate({
        target: [bloodSequences.kind, bloodSequences.year],
        set: { last: sql`${bloodSequences.last} + 1` },
      })
      .returning({ last: bloodSequences.last });
    return row!.last;
  }

  async componentTypes(ids: readonly string[]): Promise<Map<string, ComponentType>> {
    if (ids.length === 0) return new Map();
    const rows = await this.context.db
      .select({
        id: componentTypes.id,
        name: componentTypes.name,
        code: componentTypes.code,
        shelfDays: componentTypes.shelfDays,
        compatibility: componentTypes.compatibility,
        rate: componentTypes.rate,
        isActive: componentTypes.isActive,
      })
      .from(componentTypes)
      .where(inArray(componentTypes.id, [...new Set(ids)]));
    return new Map(rows.map((row) => [row.id, row]));
  }

  async insertDonor(donor: Donor): Promise<void> {
    await this.context.db.insert(donors).values(donor);
  }

  async donorForUpdate(id: string): Promise<Donor | null> {
    const [row] = await this.context.db
      .select({
        id: donors.id,
        number: donors.number,
        fullName: donors.fullName,
        sex: donors.sex,
        dateOfBirth: donors.dateOfBirth,
        bloodGroup: donors.bloodGroup,
        mobileNo: donors.mobileNo,
        address: donors.address,
        lastDonatedOn: donors.lastDonatedOn,
        deferredUntil: donors.deferredUntil,
        deferReason: donors.deferReason,
        isActive: donors.isActive,
        version: donors.version,
      })
      .from(donors)
      .where(eq(donors.id, id))
      .for('update');
    return row ?? null;
  }

  async updateDonor(donor: Donor): Promise<void> {
    const { id, ...row } = donor;
    await this.context.db
      .update(donors)
      .set({ ...row, updatedAt: new Date() })
      .where(eq(donors.id, id));
  }

  async insertDonation(donation: Donation): Promise<void> {
    await this.context.db.insert(donations).values(donation.toSnapshot());
  }

  async donationForUpdate(id: string): Promise<Donation | null> {
    const [row] = await this.context.db.select().from(donations).where(eq(donations.id, id)).for('update');
    return row ? Donation.restore(row) : null;
  }

  async updateDonation(donation: Donation): Promise<void> {
    const { id, ...row } = donation.toSnapshot();
    await this.context.db.update(donations).set(row).where(eq(donations.id, id));
  }

  async unitsOf(donationId: string): Promise<BloodUnit[]> {
    const rows = await this.context.db
      .select()
      .from(bloodUnits)
      .where(eq(bloodUnits.donationId, donationId))
      .orderBy(asc(bloodUnits.unitNumber))
      .for('update');
    return rows.map((row) => BloodUnit.restore(row));
  }

  async insertUnit(unit: BloodUnit): Promise<void> {
    await this.context.db.insert(bloodUnits).values(unit.toSnapshot());
  }

  async unitForUpdate(id: string): Promise<BloodUnit | null> {
    const [row] = await this.context.db.select().from(bloodUnits).where(eq(bloodUnits.id, id)).for('update');
    return row ? BloodUnit.restore(row) : null;
  }

  async updateUnit(unit: BloodUnit): Promise<void> {
    const { id, ...row } = unit.toSnapshot();
    await this.context.db.update(bloodUnits).set(row).where(eq(bloodUnits.id, id));
  }

  async reservedFor(requestId: string): Promise<BloodUnit[]> {
    const rows = await this.context.db
      .select()
      .from(bloodUnits)
      .where(and(eq(bloodUnits.requestId, requestId), eq(bloodUnits.status, 'reserved')))
      .for('update');
    return rows.map((row) => BloodUnit.restore(row));
  }

  async insertRequest(request: BloodRequest): Promise<void> {
    await this.context.db.insert(bloodRequests).values(request.toSnapshot());
  }

  async requestForUpdate(id: string): Promise<BloodRequest | null> {
    const [row] = await this.context.db.select().from(bloodRequests).where(eq(bloodRequests.id, id)).for('update');
    return row ? BloodRequest.restore(row) : null;
  }

  async updateRequest(request: BloodRequest): Promise<void> {
    const { id, ...row } = request.toSnapshot();
    await this.context.db.update(bloodRequests).set(row).where(eq(bloodRequests.id, id));
  }

  async addCrossmatch(row: {
    requestId: string;
    unitId: string;
    result: 'compatible' | 'incompatible';
    method: string | null;
    doneBy: string;
    doneAt: Date;
  }): Promise<void> {
    await this.context.db.insert(crossmatches).values({ ...row, id: randomUUID() });
  }

  async addIssue(row: {
    id: string;
    number: string;
    requestId: string;
    unitId: string;
    admissionId: string | null;
    issuedOn: string;
    issuedAt: Date;
    amount: number;
    voucherNumber: string | null;
    issuedBy: string;
  }): Promise<void> {
    await this.context.db.insert(bloodIssues).values(row);
  }

  async issuedCount(requestId: string): Promise<number> {
    const [row] = await this.context.db
      .select({ n: count() })
      .from(bloodIssues)
      .where(eq(bloodIssues.requestId, requestId));
    return row?.n ?? 0;
  }
}

const unitColumns = {
  id: bloodUnits.id,
  unitNumber: bloodUnits.unitNumber,
  donationId: bloodUnits.donationId,
  bagNumber: donations.bagNumber,
  componentTypeId: bloodUnits.componentTypeId,
  componentName: componentTypes.name,
  bloodGroup: bloodUnits.bloodGroup,
  preparedOn: bloodUnits.preparedOn,
  expiresOn: bloodUnits.expiresOn,
  status: bloodUnits.status,
  requestId: bloodUnits.requestId,
  version: bloodUnits.version,
};
const issuedCount =
  sql<number>`(select count(*) from ${bloodIssues} where ${bloodIssues.requestId} = ${bloodRequests.id})`.mapWith(
    Number,
  );

@Injectable()
export class DrizzleBloodReadRepository extends BloodReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async donors(filter: DonorFilter): Promise<Page<DonorSummary>> {
    const like = filter.q ? `%${escapeLike(filter.q)}%` : null;
    const where = and(
      like ? or(ilike(donors.fullName, like), ilike(donors.number, like), ilike(donors.mobileNo, like)) : undefined,
      filter.bloodGroup ? eq(donors.bloodGroup, filter.bloodGroup) : undefined,
    );
    const rows = await this.context.db
      .select({
        id: donors.id,
        number: donors.number,
        fullName: donors.fullName,
        sex: donors.sex,
        dateOfBirth: donors.dateOfBirth,
        bloodGroup: donors.bloodGroup,
        mobileNo: donors.mobileNo,
        lastDonatedOn: donors.lastDonatedOn,
        deferredUntil: donors.deferredUntil,
        isActive: donors.isActive,
      })
      .from(donors)
      .where(where)
      .orderBy(asc(donors.fullName))
      .limit(filter.pageSize)
      .offset(offsetOf(filter));
    const [total] = await this.context.db.select({ n: count() }).from(donors).where(where);
    return toPage(rows, total?.n ?? 0, filter);
  }

  private unitQuery() {
    return this.context.db
      .select(unitColumns)
      .from(bloodUnits)
      .innerJoin(donations, eq(donations.id, bloodUnits.donationId))
      .innerJoin(componentTypes, eq(componentTypes.id, bloodUnits.componentTypeId));
  }

  async donation(id: string): Promise<DonationView | null> {
    const [row] = await this.context.db
      .select({ donation: donations, donorName: donors.fullName })
      .from(donations)
      .innerJoin(donors, eq(donors.id, donations.donorId))
      .where(eq(donations.id, id));
    if (!row) return null;
    const { donation } = row;
    const units = await this.unitQuery().where(eq(bloodUnits.donationId, id)).orderBy(asc(bloodUnits.unitNumber));
    return {
      id: donation.id,
      bagNumber: donation.bagNumber,
      donorId: donation.donorId,
      donorName: row.donorName,
      donatedOn: donation.donatedOn,
      bloodGroup: donation.bloodGroup,
      volumeMl: donation.volumeMl,
      status: donation.status,
      screens: {
        hiv: donation.hiv,
        hbsag: donation.hbsag,
        hcv: donation.hcv,
        syphilis: donation.syphilis,
        malaria: donation.malaria,
      },
      discardReason: donation.discardReason,
      version: donation.version,
      units,
    };
  }

  async units(filter: UnitFilter): Promise<Page<UnitSummary>> {
    const where = and(
      filter.status ? eq(bloodUnits.status, filter.status) : undefined,
      filter.bloodGroup ? eq(bloodUnits.bloodGroup, filter.bloodGroup) : undefined,
      filter.componentTypeId ? eq(bloodUnits.componentTypeId, filter.componentTypeId) : undefined,
      filter.donationId ? eq(bloodUnits.donationId, filter.donationId) : undefined,
    );
    const rows = await this.unitQuery()
      .where(where)
      .orderBy(asc(bloodUnits.expiresOn), asc(bloodUnits.unitNumber))
      .limit(filter.pageSize)
      .offset(offsetOf(filter));
    const [total] = await this.context.db.select({ n: count() }).from(bloodUnits).where(where);
    return toPage(rows, total?.n ?? 0, filter);
  }

  private requestQuery() {
    return this.context.db
      .select({
        id: bloodRequests.id,
        number: bloodRequests.number,
        patientId: bloodRequests.patientId,
        admissionId: bloodRequests.admissionId,
        billId: bloodRequests.billId,
        componentTypeId: bloodRequests.componentTypeId,
        componentName: componentTypes.name,
        units: bloodRequests.units,
        issued: issuedCount,
        bloodGroup: bloodRequests.bloodGroup,
        requestedOn: bloodRequests.requestedOn,
        status: bloodRequests.status,
        version: bloodRequests.version,
      })
      .from(bloodRequests)
      .innerJoin(componentTypes, eq(componentTypes.id, bloodRequests.componentTypeId));
  }

  async requests(filter: RequestFilter): Promise<Page<RequestSummary>> {
    const where = and(
      filter.status ? eq(bloodRequests.status, filter.status) : undefined,
      filter.patientId ? eq(bloodRequests.patientId, filter.patientId) : undefined,
    );
    const rows = await this.requestQuery()
      .where(where)
      .orderBy(desc(bloodRequests.createdAt))
      .limit(filter.pageSize)
      .offset(offsetOf(filter));
    const [total] = await this.context.db.select({ n: count() }).from(bloodRequests).where(where);
    return toPage(rows, total?.n ?? 0, filter);
  }

  async request(id: string): Promise<RequestView | null> {
    const [summary] = await this.requestQuery().where(eq(bloodRequests.id, id));
    if (!summary) return null;
    const [extra] = await this.context.db
      .select({ reason: bloodRequests.reason })
      .from(bloodRequests)
      .where(eq(bloodRequests.id, id));
    const tried = await this.context.db
      .select({
        unitId: crossmatches.unitId,
        unitNumber: bloodUnits.unitNumber,
        result: crossmatches.result,
        method: crossmatches.method,
        doneAt: crossmatches.doneAt,
      })
      .from(crossmatches)
      .innerJoin(bloodUnits, eq(bloodUnits.id, crossmatches.unitId))
      .where(eq(crossmatches.requestId, id))
      .orderBy(asc(crossmatches.doneAt));
    const given = await this.context.db
      .select({
        id: bloodIssues.id,
        number: bloodIssues.number,
        unitId: bloodIssues.unitId,
        unitNumber: bloodUnits.unitNumber,
        issuedAt: bloodIssues.issuedAt,
        amount: bloodIssues.amount,
      })
      .from(bloodIssues)
      .innerJoin(bloodUnits, eq(bloodUnits.id, bloodIssues.unitId))
      .where(eq(bloodIssues.requestId, id))
      .orderBy(asc(bloodIssues.issuedAt));
    return { ...summary, reason: extra?.reason ?? null, crossmatches: tried, issues: given };
  }

  async issue(id: string): Promise<IssueRecord | null> {
    const [row] = await this.context.db
      .select({
        id: bloodIssues.id,
        number: bloodIssues.number,
        issuedAt: bloodIssues.issuedAt,
        amount: bloodIssues.amount,
        issuedBy: bloodIssues.issuedBy,
        requestNumber: bloodRequests.number,
        patientId: bloodRequests.patientId,
        admissionId: bloodRequests.admissionId,
        patientGroup: bloodRequests.bloodGroup,
        unitNumber: bloodUnits.unitNumber,
        bagNumber: donations.bagNumber,
        componentName: componentTypes.name,
        unitGroup: bloodUnits.bloodGroup,
        expiresOn: bloodUnits.expiresOn,
        crossmatch: sql<
          string | null
        >`(select ${crossmatches.method} from ${crossmatches} where ${crossmatches.requestId} = ${bloodRequests.id} and ${crossmatches.unitId} = ${bloodUnits.id} and ${crossmatches.result} = 'compatible' order by ${crossmatches.doneAt} desc limit 1)`,
      })
      .from(bloodIssues)
      .innerJoin(bloodRequests, eq(bloodRequests.id, bloodIssues.requestId))
      .innerJoin(bloodUnits, eq(bloodUnits.id, bloodIssues.unitId))
      .innerJoin(donations, eq(donations.id, bloodUnits.donationId))
      .innerJoin(componentTypes, eq(componentTypes.id, bloodUnits.componentTypeId))
      .where(eq(bloodIssues.id, id));
    return row ?? null;
  }
}

/** The blood bank's side of an admission's indoor bill. */
@Injectable()
export class DrizzleInpatientBlood extends InpatientBlood {
  constructor(private readonly context: DbContext) {
    super();
  }

  charges(admissionId: string): Promise<BloodCharge[]> {
    return this.context.db
      .select({
        issueId: bloodIssues.id,
        number: bloodIssues.number,
        issuedOn: bloodIssues.issuedOn,
        description: sql<string>`${componentTypes.name} || ' ' || ${bloodUnits.unitNumber}`,
        amount: bloodIssues.amount,
      })
      .from(bloodIssues)
      .innerJoin(bloodUnits, eq(bloodUnits.id, bloodIssues.unitId))
      .innerJoin(componentTypes, eq(componentTypes.id, bloodUnits.componentTypeId))
      .where(and(eq(bloodIssues.admissionId, admissionId), gt(bloodIssues.amount, 0)))
      .orderBy(asc(bloodIssues.issuedAt));
  }
}
