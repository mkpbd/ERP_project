import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import {
  FestivalBonusRepository,
  LeaveEncashmentRepository,
  PfLedgerRepository,
  type FestivalBonusLine,
  type FestivalBonusSchedule,
  type LeaveEncashmentLine,
  type NewPfEntry,
} from '../../domain/repositories.js';
import { festivalBonuses, festivalBonusLines, leaveEncashments, pfLedgerEntries } from './payroll.schema.js';

@Injectable()
export class DrizzleFestivalBonusRepository extends FestivalBonusRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async lock(bonusId: string): Promise<FestivalBonusSchedule | null> {
    const [row] = await this.context.db
      .select({
        id: festivalBonuses.id,
        festivalId: festivalBonuses.festivalId,
        payYear: festivalBonuses.payYear,
        payMonth: festivalBonuses.payMonth,
        percentOfBasic: festivalBonuses.percentOfBasic,
        joinedBy: festivalBonuses.joinedBy,
        payWithSalary: festivalBonuses.payWithSalary,
      })
      .from(festivalBonuses)
      .where(eq(festivalBonuses.id, bonusId))
      .for('update');
    return row ?? null;
  }

  async sheetStatus(bonusId: string): Promise<'none' | 'approved' | 'committed'> {
    const [row] = await this.context.db
      .select({ status: festivalBonusLines.status })
      .from(festivalBonusLines)
      .where(eq(festivalBonusLines.bonusId, bonusId))
      .limit(1);
    return row?.status ?? 'none';
  }

  async replaceLines(
    bonusId: string,
    lines: readonly FestivalBonusLine[],
    approvedBy: string,
    approvedAt: Date,
  ): Promise<void> {
    await this.context.db.delete(festivalBonusLines).where(eq(festivalBonusLines.bonusId, bonusId));
    for (let start = 0; start < lines.length; start += 500) {
      await this.context.db
        .insert(festivalBonusLines)
        .values(
          lines
            .slice(start, start + 500)
            .map((line) => ({ ...line, bonusId, status: 'approved' as const, approvedBy, approvedAt })),
        );
    }
  }

  async commit(bonusId: string): Promise<void> {
    await this.context.db
      .update(festivalBonusLines)
      .set({ status: 'committed' })
      .where(eq(festivalBonusLines.bonusId, bonusId));
  }

  async removeLines(bonusId: string): Promise<number> {
    const rows = await this.context.db
      .delete(festivalBonusLines)
      .where(eq(festivalBonusLines.bonusId, bonusId))
      .returning({ staffId: festivalBonusLines.staffId });
    return rows.length;
  }
}

@Injectable()
export class DrizzleLeaveEncashmentRepository extends LeaveEncashmentRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async replace(
    payYear: number,
    payMonth: number,
    leaveYear: number,
    lines: readonly LeaveEncashmentLine[],
    approvedBy: string,
    approvedAt: Date,
  ): Promise<void> {
    await this.remove(payYear, payMonth);
    for (let start = 0; start < lines.length; start += 500) {
      await this.context.db
        .insert(leaveEncashments)
        .values(
          lines
            .slice(start, start + 500)
            .map((line) => ({ ...line, payYear, payMonth, leaveYear, approvedBy, approvedAt })),
        );
    }
  }

  async remove(payYear: number, payMonth: number): Promise<number> {
    const rows = await this.context.db
      .delete(leaveEncashments)
      .where(and(eq(leaveEncashments.payYear, payYear), eq(leaveEncashments.payMonth, payMonth)))
      .returning({ staffId: leaveEncashments.staffId });
    return rows.length;
  }
}

@Injectable()
export class DrizzlePfLedgerRepository extends PfLedgerRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async hasInterestOn(date: string): Promise<boolean> {
    const [row] = await this.context.db
      .select({ id: pfLedgerEntries.id })
      .from(pfLedgerEntries)
      .where(and(eq(pfLedgerEntries.type, 'interest'), eq(pfLedgerEntries.entryDate, date)))
      .limit(1);
    return row !== undefined;
  }

  async add(entries: readonly NewPfEntry[]): Promise<void> {
    for (let start = 0; start < entries.length; start += 500) {
      await this.context.db
        .insert(pfLedgerEntries)
        .values(entries.slice(start, start + 500).map((entry) => ({ id: randomUUID(), ...entry })));
    }
  }
}
