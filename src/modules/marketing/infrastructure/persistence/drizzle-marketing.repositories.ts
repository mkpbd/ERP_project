import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { aliasedTable, and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { ConflictError } from '../../../../shared/domain/errors.js';
import { uniqueViolationConstraint } from '../../../../shared/infrastructure/persistence/pg-errors.js';
import { MarketingReadRepository, MarketingRepository, type PersonView } from '../../application/marketing.messages.js';
import type { Person, PersonKind } from '../../domain/team.js';
import { marketingDoctors, marketingPeople, marketingTargets, marketingZones } from './marketing.schema.js';

const parents = aliasedTable(marketingPeople, 'parents');
const personColumns = {
  id: marketingPeople.id,
  kind: marketingPeople.kind,
  name: marketingPeople.name,
  code: marketingPeople.code,
  phone: marketingPeople.phone,
  parentId: marketingPeople.parentId,
  zoneId: marketingPeople.zoneId,
  isActive: marketingPeople.isActive,
  version: marketingPeople.version,
};

@Injectable()
export class DrizzleMarketingRepository extends MarketingRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async person(id: string): Promise<Person | null> {
    const [row] = await this.context.db.select(personColumns).from(marketingPeople).where(eq(marketingPeople.id, id));
    return row ?? null;
  }

  private async unique(work: () => Promise<unknown>): Promise<void> {
    try {
      await work();
    } catch (error) {
      if (uniqueViolationConstraint(error) === 'marketing_people_code_uq') {
        throw new ConflictError('code_taken', 'Someone else has this code');
      }
      throw error;
    }
  }

  insertPerson(person: Person): Promise<void> {
    return this.unique(() => this.context.db.insert(marketingPeople).values(person));
  }

  updatePerson(person: Person): Promise<void> {
    const { id, kind: _kind, ...rest } = person;
    return this.unique(() =>
      this.context.db
        .update(marketingPeople)
        .set({ ...rest, updatedAt: new Date() })
        .where(eq(marketingPeople.id, id)),
    );
  }

  async hasReports(id: string): Promise<boolean> {
    const [row] = await this.context.db
      .select({ id: marketingPeople.id })
      .from(marketingPeople)
      .where(and(eq(marketingPeople.parentId, id), eq(marketingPeople.isActive, true)))
      .limit(1);
    return !!row;
  }

  async zoneExists(id: string): Promise<boolean> {
    const [row] = await this.context.db
      .select({ id: marketingZones.id })
      .from(marketingZones)
      .where(eq(marketingZones.id, id));
    return !!row;
  }

  async setDoctors(officerId: string, doctorIds: readonly string[]): Promise<void> {
    await this.context.db.delete(marketingDoctors).where(eq(marketingDoctors.officerId, officerId));
    if (doctorIds.length === 0) return;
    await this.context.db.delete(marketingDoctors).where(inArray(marketingDoctors.doctorId, [...doctorIds]));
    await this.context.db.insert(marketingDoctors).values(doctorIds.map((doctorId) => ({ doctorId, officerId })));
  }

  async setTarget(officerId: string | null, year: number, month: number, amount: number | null): Promise<void> {
    const same = and(
      officerId ? eq(marketingTargets.officerId, officerId) : isNull(marketingTargets.officerId),
      eq(marketingTargets.year, year),
      eq(marketingTargets.month, month),
    );
    await this.context.db.delete(marketingTargets).where(same);
    if (amount !== null) {
      await this.context.db.insert(marketingTargets).values({ id: randomUUID(), officerId, year, month, amount });
    }
  }
}

@Injectable()
export class DrizzleMarketingReadRepository extends MarketingReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  people(kind?: PersonKind): Promise<PersonView[]> {
    return this.context.db
      .select({ ...personColumns, parentName: parents.name, zoneName: marketingZones.name })
      .from(marketingPeople)
      .leftJoin(parents, eq(parents.id, marketingPeople.parentId))
      .leftJoin(marketingZones, eq(marketingZones.id, marketingPeople.zoneId))
      .where(kind ? eq(marketingPeople.kind, kind) : undefined)
      .orderBy(
        sql`case ${marketingPeople.kind} when 'manager' then 1 when 'officer' then 2 else 3 end`,
        asc(marketingPeople.name),
      );
  }

  async doctorsOf(officerId: string): Promise<string[]> {
    const rows = await this.context.db
      .select({ doctorId: marketingDoctors.doctorId })
      .from(marketingDoctors)
      .where(eq(marketingDoctors.officerId, officerId));
    return rows.map((row) => row.doctorId);
  }

  async links(): Promise<Map<string, string>> {
    const rows = await this.context.db.select().from(marketingDoctors);
    return new Map(rows.map((row) => [row.doctorId, row.officerId]));
  }

  async targets(year: number, month: number): Promise<Map<string | null, number>> {
    const rows = await this.context.db
      .select({ officerId: marketingTargets.officerId, amount: marketingTargets.amount })
      .from(marketingTargets)
      .where(and(eq(marketingTargets.year, year), eq(marketingTargets.month, month)));
    return new Map(rows.map((row) => [row.officerId, row.amount]));
  }
}
