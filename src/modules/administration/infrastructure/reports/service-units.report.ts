import { asc, eq } from 'drizzle-orm';
import type { Content, TableCell } from 'pdfmake/interfaces.js';
import { z } from 'zod';
import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import type { PdfmakeReportDocument } from '../../../../shared/infrastructure/reports/pdfmake-document.js';
import { adminDepartments, serviceUnits } from '../persistence/administration.schema.js';

// A type alias (not an interface) so rows satisfy ReportTable's record type.
type ServiceUnitRow = {
  department: string;
  serviceUnit: string;
};

/** Reference report for the pdfmake engine: a short Latin-script list. */
export function serviceUnitsReport(context: DbContext): ReportDefinition {
  return defineReport({
    key: 'admin.service-units',
    title: 'Service units by department',
    group: 'Administration',
    description: 'Every service unit with its department.',
    params: z.strictObject({ departmentId: z.uuid().optional() }),
    async load(params): Promise<ServiceUnitRow[]> {
      return context.db
        .select({ department: adminDepartments.name, serviceUnit: serviceUnits.name })
        .from(serviceUnits)
        .innerJoin(adminDepartments, eq(adminDepartments.id, serviceUnits.departmentId))
        .where(params.departmentId ? eq(serviceUnits.departmentId, params.departmentId) : undefined)
        .orderBy(asc(adminDepartments.name), asc(serviceUnits.name));
    },
    describe: (params, rows) => (params.departmentId ? `Department: ${rows[0]?.department ?? '—'}` : 'All departments'),
    pdf: {
      engine: 'pdfmake',
      document: (rows): PdfmakeReportDocument => {
        const body: TableCell[][] = [
          [
            { text: '#', style: 'tableHeader' },
            { text: 'Department', style: 'tableHeader' },
            { text: 'Service unit', style: 'tableHeader' },
          ],
          ...rows.map((row, index): TableCell[] => [String(index + 1), row.department, row.serviceUnit]),
        ];
        const content: Content =
          rows.length > 0
            ? { table: { headerRows: 1, widths: [24, '*', '*'], body }, layout: 'lightHorizontalLines' }
            : { text: 'No service units.', alignment: 'center', margin: [0, 16] };
        return { content };
      },
    },
    xlsx: (rows) => ({
      columns: [
        { key: 'department', header: 'Department', width: 30 },
        { key: 'serviceUnit', header: 'Service unit', width: 30 },
      ],
      rows,
    }),
  });
}
