import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { ReferredBilling, type ReferredAmounts } from '../../../../shared/application/contracts/referred-billing.js';
import { HOSPITAL_SETTINGS, type HospitalSettings } from '../../application/patient.handlers.js';
import { admissions, diagnosticBills, doctors, ipdBills, opdBills } from './hospital.schema.js';

const cents = (value: number) => Math.round(value * 100) / 100;

/** The hospital's billing on doctors' referrals. */
@Injectable()
export class DrizzleReferredBilling extends ReferredBilling {
  constructor(
    private readonly context: DbContext,
    @Inject(HOSPITAL_SETTINGS) private readonly settings: HospitalSettings,
  ) {
    super();
  }

  async referred(from: string, to: string): Promise<ReferredAmounts[]> {
    const opd = await this.context.db
      .select({
        doctorId: opdBills.referredById,
        amount: sql<number>`sum(${opdBills.net})`.mapWith(Number),
      })
      .from(opdBills)
      .where(
        and(
          isNotNull(opdBills.referredById),
          eq(opdBills.status, 'billed'),
          gte(opdBills.billedOn, from),
          lte(opdBills.billedOn, to),
        ),
      )
      .groupBy(opdBills.referredById);
    const billedOn = sql`(${diagnosticBills.billedAt} at time zone ${this.settings.timeZone})::date`;
    const diagnostic = await this.context.db
      .select({
        doctorId: diagnosticBills.referredById,
        amount: sql<number>`sum(${diagnosticBills.net} - ${diagnosticBills.cancelled})`.mapWith(Number),
      })
      .from(diagnosticBills)
      .where(
        and(
          isNotNull(diagnosticBills.referredById),
          eq(diagnosticBills.status, 'billed'),
          sql`${billedOn} between ${from}::date and ${to}::date`,
        ),
      )
      .groupBy(diagnosticBills.referredById);
    const indoor = await this.context.db
      .select({
        doctorId: admissions.referredById,
        amount: sql<number>`sum(${ipdBills.net})`.mapWith(Number),
      })
      .from(ipdBills)
      .innerJoin(admissions, eq(admissions.id, ipdBills.admissionId))
      .where(
        and(
          isNotNull(admissions.referredById),
          eq(ipdBills.status, 'billed'),
          gte(ipdBills.billedOn, from),
          lte(ipdBills.billedOn, to),
        ),
      )
      .groupBy(admissions.referredById);
    const totals = new Map<string, { opd: number; diagnostic: number; indoor: number }>();
    const add = (rows: { doctorId: string | null; amount: number }[], key: 'opd' | 'diagnostic' | 'indoor') => {
      for (const row of rows) {
        if (!row.doctorId) continue;
        const entry = totals.get(row.doctorId) ?? { opd: 0, diagnostic: 0, indoor: 0 };
        entry[key] = cents(entry[key] + row.amount);
        totals.set(row.doctorId, entry);
      }
    };
    add(opd, 'opd');
    add(diagnostic, 'diagnostic');
    add(indoor, 'indoor');
    if (totals.size === 0) return [];
    const names = await this.context.db
      .select({ id: doctors.id, name: doctors.name })
      .from(doctors)
      .where(inArray(doctors.id, [...totals.keys()]));
    const nameOf = new Map(names.map((row) => [row.id, row.name]));
    return [...totals.entries()]
      .map(([doctorId, amounts]) => ({ doctorId, doctorName: nameOf.get(doctorId) ?? '', ...amounts }))
      .sort((a, b) => a.doctorName.localeCompare(b.doctorName));
  }
}
