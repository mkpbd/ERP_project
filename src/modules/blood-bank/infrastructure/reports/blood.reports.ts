import { fileURLToPath } from 'node:url';
import { asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { OrganizationProfile } from '../../../../shared/application/contracts/organization-profile.js';
import type { PatientDirectory } from '../../../../shared/application/contracts/patient-directory.js';
import type { UserDirectory } from '../../../../shared/application/contracts/user-directory.js';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import type { BloodReadRepository } from '../../application/blood.messages.js';
import { addDays, BLOOD_GROUPS, type BloodGroup } from '../../domain/blood.js';
import { bloodUnits, componentTypes } from '../persistence/blood-bank.schema.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));

/** Units out of date within this many days are flagged. */
const EXPIRING_DAYS = 7;

function dayIn(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const count = (condition: SQL) => sql<number>`count(*) filter (where ${condition})`.mapWith(Number);

/**
 * The blood stock (new: the old TransfusionMedicine kept donations, not units): units on the shelf by component and
 * group, those still in quarantine, kept for a request, about to go out of date, and out of date but not discarded yet.
 */
export function bloodStockReport(context: DbContext): ReportDefinition {
  return defineReport({
    key: 'blood-bank.stock',
    title: 'Blood stock',
    group: 'Blood bank',
    description: `Units by component and group: quarantine, available, reserved, out of date within ${EXPIRING_DAYS} days and out of date.`,
    params: z.strictObject({}),
    async load(_params, report) {
      const today = dayIn(report.generatedAt, report.timeZone);
      const soon = addDays(today, EXPIRING_DAYS);
      const fresh = sql`${bloodUnits.expiresOn} >= ${today}`;
      const rows = await context.db
        .select({
          componentName: componentTypes.name,
          bloodGroup: bloodUnits.bloodGroup,
          quarantine: count(sql`${bloodUnits.status} = 'quarantine' and ${fresh}`),
          available: count(sql`${bloodUnits.status} = 'available' and ${fresh}`),
          reserved: count(sql`${bloodUnits.status} = 'reserved' and ${fresh}`),
          expiring: count(
            sql`${bloodUnits.status} in ('available', 'reserved') and ${fresh} and ${bloodUnits.expiresOn} <= ${soon}`,
          ),
          expired: count(sql`${bloodUnits.expiresOn} < ${today}`),
        })
        .from(bloodUnits)
        .innerJoin(componentTypes, eq(componentTypes.id, bloodUnits.componentTypeId))
        .where(inArray(bloodUnits.status, ['quarantine', 'available', 'reserved']))
        .groupBy(componentTypes.name, bloodUnits.bloodGroup)
        .orderBy(asc(componentTypes.name));
      const order = (group: BloodGroup) => BLOOD_GROUPS.indexOf(group);
      rows.sort((a, b) => a.componentName.localeCompare(b.componentName) || order(a.bloodGroup) - order(b.bloodGroup));
      const total = (key: 'quarantine' | 'available' | 'reserved' | 'expiring' | 'expired') =>
        rows.reduce((sum, row) => sum + row[key], 0);
      return {
        today,
        expiringDays: EXPIRING_DAYS,
        rows,
        totals: {
          quarantine: total('quarantine'),
          available: total('available'),
          reserved: total('reserved'),
          expiring: total('expiring'),
          expired: total('expired'),
        },
      };
    },
    describe: (_params, data) => `As of ${data.today}`,
    pdf: { engine: 'html', template: template('blood-stock') },
    xlsx: (data) => ({
      columns: [
        { key: 'componentName', header: 'Component', width: 26 },
        { key: 'bloodGroup', header: 'Group', width: 8 },
        { key: 'quarantine', header: 'Quarantine', format: 'integer' },
        { key: 'available', header: 'Available', format: 'integer' },
        { key: 'reserved', header: 'Reserved', format: 'integer' },
        { key: 'expiring', header: `Out of date in ${EXPIRING_DAYS} days`, format: 'integer' },
        { key: 'expired', header: 'Out of date', format: 'integer' },
      ],
      rows: data.rows,
    }),
  });
}

/**
 * The blood issue slip (new: the old system recorded no issue): the unit given to a patient, its bag, component,
 * group and expiry, the cross-match it passed and who issued it, to go with the bag to the ward.
 */
export function bloodIssueSlip(
  read: BloodReadRepository,
  patients: PatientDirectory,
  organization: OrganizationProfile,
  users: UserDirectory,
): ReportDefinition {
  return defineReport({
    key: 'blood-bank.issue-slip',
    title: 'Blood issue slip',
    group: 'Blood bank',
    description: 'A unit issued to a patient: bag, component, group, expiry, cross-match and who issued it.',
    params: z.strictObject({ issueId: z.uuid() }),
    async load(params, report) {
      const issue = await read.issue(params.issueId);
      if (!issue) throw new NotFoundError('blood_issue');
      const patient = (await patients.find([issue.patientId])).get(issue.patientId);
      if (!patient) throw new NotFoundError('patient');
      const issuer = issue.issuedBy ? (await users.findSummaries([issue.issuedBy]))[0]?.displayName : undefined;
      return {
        organization: report.header,
        issue,
        patient: { ...patient, uhidLabel: `${await organization.patientIdPrefix()}${patient.uhid}` },
        issuer: issuer ?? null,
      };
    },
    describe: (_params, data) => `${data.issue.number} · ${data.patient.name}`,
    pdf: { engine: 'html', template: template('issue-slip'), bare: true },
  });
}
