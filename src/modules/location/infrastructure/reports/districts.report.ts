import { fileURLToPath } from 'node:url';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { districts, divisions } from '../persistence/location.schema.js';

// A type alias (not an interface) so rows satisfy ReportTable's record type.
type DistrictRow = {
  division: string;
  district: string;
  districtBn: string | null;
};

/** Reference report for the HTML engine, with Bangla names. */
export function districtsReport(context: DbContext): ReportDefinition {
  return defineReport({
    key: 'location.districts',
    title: 'Districts by division',
    group: 'Location',
    description: 'Every district with its division and Bangla name.',
    params: z.strictObject({ divisionId: z.uuid().optional() }),
    async load(params): Promise<DistrictRow[]> {
      return context.db
        .select({ division: divisions.name, district: districts.name, districtBn: districts.nameBn })
        .from(districts)
        .innerJoin(divisions, eq(divisions.id, districts.divisionId))
        .where(params.divisionId ? eq(districts.divisionId, params.divisionId) : undefined)
        .orderBy(asc(divisions.name), asc(districts.name));
    },
    describe: (params, rows) => (params.divisionId ? `Division: ${rows[0]?.division ?? '—'}` : 'All divisions'),
    pdf: { engine: 'html', template: fileURLToPath(new URL('./districts.hbs', import.meta.url)) },
    xlsx: (rows) => ({
      columns: [
        { key: 'division', header: 'Division', width: 20 },
        { key: 'district', header: 'District', width: 24 },
        { key: 'districtBn', header: 'District (Bangla)', width: 24 },
      ],
      rows,
    }),
  });
}
