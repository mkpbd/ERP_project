import { sql } from 'drizzle-orm';
import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { DashboardSection } from '../../../../shared/application/dashboards.js';
import { dayOf, sqlHead } from '../../../../shared/infrastructure/persistence/dashboard-heads.js';
import { labResults, labSamples } from '../persistence/laboratory.schema.js';

/**
 * Old diagnostic dashboard's lab side and sample collection log: samples taken and turned away, results verified,
 * and what is still waiting. Tests by department are on the diagnostics section.
 */
export function labDashboard(context: DbContext): DashboardSection {
  const head = (spec: Parameters<typeof sqlHead>[1]) => sqlHead(context, spec);
  return {
    key: 'laboratory',
    title: 'Laboratory',
    order: 40,
    permissions: ['lab:read'],
    heads: [
      head({
        key: 'laboratory.samples',
        label: 'Samples collected',
        unit: 'count',
        from: sql`${labSamples}`,
        day: () => sql`${labSamples.collectedOn}`,
        value: sql`count(*)`,
        dimensions: {
          status: { label: 'Status', expr: sql`${labSamples.status}` },
          user: { label: 'Collected by', expr: sql`${labSamples.collectedBy}`, users: true },
        },
      }),
      head({
        key: 'laboratory.rejected',
        label: 'Samples rejected',
        unit: 'count',
        from: sql`${labSamples}`,
        day: () => sql`${labSamples.collectedOn}`,
        where: () => sql`${labSamples.status} = 'rejected'`,
        value: sql`count(*)`,
        dimensions: { reason: { label: 'Reason', expr: sql`${labSamples.rejectReason}` } },
      }),
      head({
        key: 'laboratory.verified',
        label: 'Results verified',
        unit: 'count',
        from: sql`${labResults}`,
        day: (range) => dayOf(labResults.verifiedAt, range),
        where: () => sql`${labResults.status} in ('verified', 'delivered')`,
        value: sql`count(*)`,
        dimensions: {
          user: { label: 'Verified by', expr: sql`${labResults.verifiedBy}`, users: true },
          form: { label: 'Report form', expr: sql`${labResults.form}` },
        },
      }),
      head({
        key: 'laboratory.waiting',
        label: 'Results waiting now',
        unit: 'count',
        hint: 'Not yet entered or not yet verified',
        from: sql`${labResults}`,
        where: () => sql`${labResults.status} in ('pending', 'entered')`,
        value: sql`count(*)`,
        dimensions: {
          status: { label: 'Status', expr: sql`${labResults.status}` },
          form: { label: 'Report form', expr: sql`${labResults.form}` },
        },
      }),
    ],
  };
}
