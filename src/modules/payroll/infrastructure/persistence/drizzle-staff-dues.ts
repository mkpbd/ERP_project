import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { StaffLedger, type StaffLedgerEntry } from '../../../../shared/application/contracts/staff-ledger.js';
import { TransactionManager } from '../../../../shared/application/ports/transaction-manager.js';
import { StaffDueRepository } from '../../domain/repositories.js';
import { salaryDeductions, staffDues } from './payroll.schema.js';

const balance = sql<number>`coalesce(sum(${staffDues.debit} - ${staffDues.credit}), 0)`.mapWith(Number);

/** The staff ledger (`staff_dues`) as other modules charge to it; each person's ledger locked while it changes. */
@Injectable()
export class DrizzleStaffLedger extends StaffLedger {
  constructor(
    private readonly context: DbContext,
    private readonly tx: TransactionManager,
  ) {
    super();
  }

  async lockBalance(staffId: string): Promise<number> {
    await this.tx.lock(`payroll:staff-dues:${staffId}`);
    return this.balance(staffId);
  }

  async balance(staffId: string): Promise<number> {
    const [row] = await this.context.db.select({ balance }).from(staffDues).where(eq(staffDues.staffId, staffId));
    return Math.round((row?.balance ?? 0) * 100) / 100;
  }

  async post(entry: StaffLedgerEntry): Promise<void> {
    await this.context.db.insert(staffDues).values({ id: randomUUID(), serviceUnitId: null, ...entry });
  }
}

@Injectable()
export class DrizzleStaffDueRepository extends StaffDueRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async owing(): Promise<Map<string, number>> {
    const rows = await this.context.db
      .select({ staffId: staffDues.staffId, balance })
      .from(staffDues)
      .groupBy(staffDues.staffId)
      .having(sql`sum(${staffDues.debit} - ${staffDues.credit}) > 0`);
    return new Map(rows.map((row) => [row.staffId, Math.round(row.balance * 100) / 100]));
  }

  async addOtherDeduction(staffId: string, year: number, month: number, amount: number, cause: string): Promise<void> {
    await this.context.db
      .insert(salaryDeductions)
      .values({ id: randomUUID(), staffId, payYear: year, payMonth: month, otherDeduction: amount, cause })
      .onConflictDoUpdate({
        target: [salaryDeductions.staffId, salaryDeductions.payYear, salaryDeductions.payMonth],
        set: {
          otherDeduction: sql`${salaryDeductions.otherDeduction} + ${amount}`,
          // Said once, however often the month is recovered.
          cause: sql`case when position(${cause} in ${salaryDeductions.cause}) > 0 then ${salaryDeductions.cause}
            else left(${salaryDeductions.cause} || '; ' || ${cause}, 500) end`,
          updatedAt: new Date(),
        },
      });
  }
}
