import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import type { CountReadRepository } from '../../application/count.messages.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));

/** Old StockAuditDetailsDocument used for counting: lots with a blank to write the count in (system figures hidden). */
export function countSheetReport(read: CountReadRepository): ReportDefinition {
  return defineReport({
    key: 'pharmacy.count-sheet',
    title: 'Stock count sheet',
    group: 'Pharmacy',
    description:
      'The lots to count, with batch and expiry and a blank for the count; what the system holds is not shown.',
    params: z.strictObject({ id: z.uuid() }),
    async load(params) {
      const count = await read.getCount(params.id);
      if (!count) throw new NotFoundError('stock_count');
      return { count };
    },
    describe: (_params, data) => `${data.count.number} · ${data.count.outletName} · as of ${data.count.countDate}`,
    pdf: { engine: 'html', template: template('count-sheet') },
  });
}

/** Old AuditReportGridDocument (difference, excess, equal): the count against the ledger, lot by lot, at cost. */
export function countResultReport(read: CountReadRepository): ReportDefinition {
  return defineReport({
    key: 'pharmacy.count-result',
    title: 'Stock count result',
    group: 'Pharmacy',
    description:
      'Each lot counted against the ledger as of the count date: short, over or equal, at cost, with totals.',
    params: z.strictObject({ id: z.uuid(), differencesOnly: z.boolean().default(false) }),
    async load(params) {
      const count = await read.getCount(params.id);
      if (!count) throw new NotFoundError('stock_count');
      const lines = count.lines.map((line) => {
        const system = line.appliedSystemQty ?? line.systemQty;
        const difference = line.countedQty === null ? null : line.countedQty - system;
        return {
          ...line,
          system,
          difference,
          differenceValue: difference === null ? null : Math.round(difference * line.unitCost * 100) / 100,
        };
      });
      const shown = params.differencesOnly ? lines.filter((line) => line.difference !== 0) : lines;
      const sum = (pick: (line: (typeof lines)[number]) => number) =>
        Math.round(lines.reduce((total, line) => total + pick(line), 0) * 100) / 100;
      return {
        count,
        lines: shown,
        short: sum((line) => Math.min(0, line.differenceValue ?? 0)),
        over: sum((line) => Math.max(0, line.differenceValue ?? 0)),
        expiredValue: sum((line) => (line.expired ? (line.countedQty ?? line.system) * line.unitCost : 0)),
      };
    },
    describe: (params, data) =>
      `${data.count.number} · ${data.count.outletName} · as of ${data.count.countDate}${params.differencesOnly ? ' · differences only' : ''}`,
    pdf: { engine: 'html', template: template('count-result'), landscape: true },
    xlsx: (data) => ({
      columns: [
        { key: 'line', header: '#', format: 'integer' },
        { key: 'displayName', header: 'Product', width: 28 },
        { key: 'batchNo', header: 'Batch', width: 14 },
        { key: 'expiryDate', header: 'Expiry', format: 'date' },
        { key: 'system', header: 'System', format: 'integer' },
        { key: 'countedQty', header: 'Counted', format: 'integer' },
        { key: 'difference', header: 'Difference', format: 'integer' },
        { key: 'unitCost', header: 'Unit cost', format: 'decimal' },
        { key: 'differenceValue', header: 'Difference value', format: 'money' },
        { key: 'note', header: 'Note', width: 24 },
      ],
      rows: data.lines.map((line) => ({ ...line })),
    }),
  });
}
