import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { DomainError, NotFoundError } from '../../../../shared/domain/errors.js';
import type { AssetRequestReadRepository } from '../../application/asset-request.handlers.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));

/** Old PrintDiscardSoldInvoiceDocument ("Invoice of Material Discard Sold"): a sale of written-off assets or scrap. */
export function disposalInvoiceReport(read: AssetRequestReadRepository): ReportDefinition {
  return defineReport({
    key: 'scm.disposal-invoice',
    title: 'Invoice of material disposed of and sold',
    group: 'Supply chain',
    description: 'The invoice for the sale of written-off assets or of scrap, with the total in words.',
    params: z.strictObject({ kind: z.enum(['discard', 'scrap_sale']), id: z.uuid() }),
    async load(params) {
      const document = await read.get(params.kind, params.id);
      if (!document) throw new NotFoundError(params.kind === 'discard' ? 'asset_discard_request' : 'scrap_sale');
      const invoiceNo = document.fields['invoiceNo'];
      if (!invoiceNo) throw new DomainError('not_sold', 'Nothing is sold on this document yet');
      const lines =
        params.kind === 'discard'
          ? document.lines
              .filter((line) => !line['rejected'])
              .map((line) => ({
                description: `${String(line['assetNo'])} (written off)`,
                qty: 1,
                unitPrice: line['saleAmount'] ?? 0,
                total: line['saleAmount'] ?? 0,
              }))
          : document.lines.map((line) => ({
              description: String(line['description']),
              qty: line['qty'],
              unit: line['unit'],
              unitPrice: line['unitPrice'],
              total: line['total'],
            }));
      const total = Math.round(lines.reduce((sum, line) => sum + Number(line.total) * 100, 0)) / 100;
      return { document, invoiceNo, lines, total, date: document.fields['soldOn'] ?? document.date };
    },
    describe: (_params, data) => `${String(data.invoiceNo)} · ${data.document.party ?? ''}`,
    pdf: { engine: 'html', template: template('disposal-invoice') },
  });
}
