import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { monthlyPerformance, type MarketingDesk } from '../../application/marketing.handlers.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Old MPO sales target vs achievement: a month, officer by officer, and the gross. */
export function marketingPerformanceReport(desk: MarketingDesk): ReportDefinition {
  return defineReport({
    key: 'marketing.performance',
    title: 'Marketing target and achievement',
    group: 'Marketing',
    description: "Each officer's referred billing (consultations, tests, indoor) in a month against their target.",
    params: z.strictObject({ year: z.int().min(2000).max(2100), month: z.int().min(1).max(12) }),
    load: (params) => monthlyPerformance(desk, params.year, params.month),
    describe: (params) => `${MONTHS[params.month - 1]} ${params.year}`,
    pdf: { engine: 'html', template: template('performance'), landscape: true },
    xlsx: (data) => ({
      columns: [
        { key: 'officerName', header: 'Officer', width: 24 },
        { key: 'managerName', header: 'Manager', width: 22 },
        { key: 'zoneName', header: 'Zone', width: 16 },
        { key: 'doctors', header: 'Doctors', format: 'integer' },
        { key: 'opd', header: 'Consultations', format: 'money' },
        { key: 'diagnostic', header: 'Tests', format: 'money' },
        { key: 'indoor', header: 'Indoor', format: 'money' },
        { key: 'achieved', header: 'Achieved', format: 'money' },
        { key: 'target', header: 'Target', format: 'money' },
        { key: 'percent', header: '%', format: 'decimal' },
      ],
      rows: data.rows.map((row) => ({ ...row })),
    }),
  });
}
