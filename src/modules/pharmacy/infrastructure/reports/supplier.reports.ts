import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import type { SupplierReadRepository } from '../../application/supplier.messages.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));

/** Old PrintSupplierPaymentReceiptDocument: what was paid against each receive, and the total in words. */
export function supplierPaymentReport(read: SupplierReadRepository): ReportDefinition {
  return defineReport({
    key: 'pharmacy.supplier-payment',
    title: 'Supplier payment receipt',
    group: 'Pharmacy',
    description: 'One payment to a supplier: the receives paid, what was due before and after, the total in words.',
    params: z.strictObject({ id: z.uuid() }),
    async load(params) {
      const payment = await read.getPayment(params.id);
      if (!payment) throw new NotFoundError('supplier_payment');
      return { payment };
    },
    describe: (_params, data) => `${data.payment.number} · ${data.payment.supplierName}`,
    pdf: { engine: 'html', template: template('supplier-payment') },
  });
}

/** Old PrintSupplierReturnIndentDocument / PrintSupplierReturnReceiveDocument: the lots returned and replaced. */
export function supplierReturnReport(read: SupplierReadRepository): ReportDefinition {
  return defineReport({
    key: 'pharmacy.supplier-return',
    title: 'Medicine return to supplier',
    group: 'Pharmacy',
    description: 'One supplier return: lots sent back at cost, replacements received and what is still owed.',
    params: z.strictObject({ id: z.uuid() }),
    async load(params) {
      const supplierReturn = await read.getReturn(params.id);
      if (!supplierReturn) throw new NotFoundError('supplier_return');
      return {
        supplierReturn,
        owed: Math.round((supplierReturn.value - supplierReturn.settledValue) * 100) / 100,
      };
    },
    describe: (_params, data) => `${data.supplierReturn.number} · ${data.supplierReturn.supplierName}`,
    pdf: { engine: 'html', template: template('supplier-return') },
  });
}
