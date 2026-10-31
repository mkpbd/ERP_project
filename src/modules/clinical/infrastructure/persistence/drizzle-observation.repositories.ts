import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { ObservationReadRepository } from '../../application/observation.messages.js';
import type { ObservationRound } from '../../domain/observation.js';
import { ObservationRepository, type ObservationRow } from '../../domain/repositories.js';
import { observationRounds, observations } from './clinical.schema.js';

@Injectable()
export class DrizzleObservationRepository extends ObservationRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async rounds(): Promise<ObservationRound[]> {
    return this.context.db
      .select({
        id: observationRounds.id,
        name: observationRounds.name,
        startTime: observationRounds.startTime,
        endTime: observationRounds.endTime,
      })
      .from(observationRounds)
      .where(eq(observationRounds.isActive, true))
      .orderBy(asc(observationRounds.startTime));
  }

  async insert(row: ObservationRow): Promise<void> {
    await this.context.db.insert(observations).values(row);
  }

  async findForUpdate(id: string): Promise<ObservationRow | null> {
    const [row] = await this.context.db.select().from(observations).where(eq(observations.id, id)).for('update');
    return row ?? null;
  }

  async strike(id: string, by: string, at: Date, reason: string): Promise<void> {
    await this.context.db
      .update(observations)
      .set({ struckAt: at, struckBy: by, struckReason: reason })
      .where(eq(observations.id, id));
  }
}

@Injectable()
export class DrizzleObservationReadRepository extends ObservationReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  list(admissionId: string, from: Date, to: Date): Promise<ObservationRow[]> {
    return this.context.db
      .select()
      .from(observations)
      .where(
        and(eq(observations.admissionId, admissionId), gte(observations.takenAt, from), lt(observations.takenAt, to)),
      )
      .orderBy(asc(observations.takenAt));
  }

  async answered(admissionIds: readonly string[], day: string): Promise<Map<string, Set<string>>> {
    const map = new Map<string, Set<string>>();
    if (admissionIds.length === 0) return map;
    const rows = await this.context.db
      .select({ admissionId: observations.admissionId, roundId: observations.roundId })
      .from(observations)
      .where(
        and(
          inArray(observations.admissionId, [...admissionIds]),
          eq(observations.roundOn, day),
          isNull(observations.struckAt),
        ),
      );
    for (const row of rows) {
      if (!row.roundId) continue;
      map.set(row.admissionId, (map.get(row.admissionId) ?? new Set()).add(row.roundId));
    }
    return map;
  }

  async latest(admissionIds: readonly string[]): Promise<Map<string, ObservationRow>> {
    if (admissionIds.length === 0) return new Map();
    const rows = await this.context.db
      .selectDistinctOn([observations.admissionId])
      .from(observations)
      .where(and(inArray(observations.admissionId, [...admissionIds]), isNull(observations.struckAt)))
      .orderBy(asc(observations.admissionId), desc(observations.takenAt));
    return new Map(rows.map((row) => [row.admissionId, row]));
  }

  async roundNames(): Promise<Map<string, string>> {
    const rows = await this.context.db
      .select({ id: observationRounds.id, name: observationRounds.name })
      .from(observationRounds);
    return new Map(rows.map((row) => [row.id, row.name]));
  }
}
