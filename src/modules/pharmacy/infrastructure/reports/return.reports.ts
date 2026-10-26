import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import type { ReturnReadRepository } from '../../application/return.messages.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));

/** The customer's slip for medicines brought back: what came back and what was refunded, on an 80 mm roll. */
export function returnReceiptReport(read: ReturnReadRepository): ReportDefinition {
  return defineReport({
    key: 'pharmacy.return-receipt',
    title: 'Medicine return receipt',
    group: 'Pharmacy',
    description: "One return's slip: medicines given back, the discount taken back, the refund and the due reduced.",
    params: z.strictObject({ id: z.uuid() }),
    async load(params, report) {
      const saleReturn = await read.getReturn(params.id);
      if (!saleReturn) throw new NotFoundError('sale_return');
      return { saleReturn, organization: report.header.organizationName, printedBy: report.printedBy };
    },
    describe: (_params, data) => data.saleReturn.number,
    pdf: {
      engine: 'html',
      template: template('return-receipt'),
      bare: true,
      paper: { width: '80mm', height: '200mm' },
    },
  });
}
