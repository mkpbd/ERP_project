import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import type { TransferReadRepository } from '../../application/transfer.messages.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));

/** Old PrintStockTransferDocument: what one outlet sent another, by lot, at cost. */
export function transferReport(read: TransferReadRepository): ReportDefinition {
  return defineReport({
    key: 'pharmacy.transfer',
    title: 'Medicine transfer',
    group: 'Pharmacy',
    description: 'One transfer between outlets: products by lot with batch, expiry, units and cost, and its state.',
    params: z.strictObject({ id: z.uuid() }),
    async load(params) {
      const transfer = await read.getTransfer(params.id);
      if (!transfer) throw new NotFoundError('transfer');
      return { transfer };
    },
    describe: (_params, data) =>
      `${data.transfer.number} · ${data.transfer.fromOutletName} → ${data.transfer.toOutletName}`,
    pdf: { engine: 'html', template: template('transfer') },
  });
}
