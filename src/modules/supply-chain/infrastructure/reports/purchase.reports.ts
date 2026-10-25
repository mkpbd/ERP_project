import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import type { PurchaseReadRepository, QuoteView } from '../../application/purchase.messages.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));
const byId = z.strictObject({ id: z.uuid() });
const STATUS: Record<string, string> = {
  draft: 'Draft',
  pending: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  open: 'Open',
  partially_received: 'Partly received',
  received: 'Received',
  closed: 'Closed',
};

/** Old PR print: the requisition with requested and approved quantities and who approved it. */
export function requisitionReport(read: PurchaseReadRepository): ReportDefinition {
  return defineReport({
    key: 'scm.purchase-requisition',
    title: 'Purchase requisition',
    group: 'Supply chain',
    description: 'One requisition: items with requested, approved and ordered quantities, and its approvals.',
    params: byId,
    async load(params) {
      const requisition = await read.getRequisition(params.id);
      if (!requisition) throw new NotFoundError('purchase_requisition');
      return { requisition, status: STATUS[requisition.status] ?? requisition.status };
    },
    describe: (_params, data) => `${data.requisition.number} · ${data.status}`,
    pdf: { engine: 'html', template: template('purchase-requisition') },
  });
}

/** Old CS compare report (whose procedures mixed up items): each item's quotes side by side, winners marked. */
export function comparativeStudyReport(read: PurchaseReadRepository): ReportDefinition {
  return defineReport({
    key: 'scm.comparative-study',
    title: 'Comparative statement',
    group: 'Supply chain',
    description:
      "One comparative study: every supplier's quote per item side by side, the lowest and the chosen marked.",
    params: byId,
    async load(params) {
      const study = await read.getStudy(params.id);
      if (!study) throw new NotFoundError('comparative_study');
      const suppliers = [...new Map(study.quotes.map((quote) => [quote.supplierId, quote.supplierName])).entries()].map(
        ([id, name]) => ({ id, name }),
      );
      const itemKey = (quote: QuoteView) => quote.variantId ?? `manual:${quote.itemName.toUpperCase()}`;
      const rows = [...new Map(study.quotes.map((quote) => [itemKey(quote), quote])).values()].map((first) => {
        const quotes = study.quotes.filter((quote) => itemKey(quote) === itemKey(first));
        const lowest = Math.min(...quotes.map((quote) => quote.total));
        return {
          itemName: first.itemName,
          unit: first.unit,
          cells: suppliers.map((supplier) => {
            const quote = quotes.find((entry) => entry.supplierId === supplier.id);
            return quote
              ? {
                  quoted: true,
                  qty: quote.qty,
                  unitPrice: quote.unitPrice,
                  total: quote.total,
                  lowest: quote.total === lowest,
                  chosen: study.status === 'approved' && quote.selected,
                }
              : { quoted: false };
          }),
        };
      });
      return { study, suppliers, rows, status: STATUS[study.status] ?? study.status };
    },
    describe: (_params, data) => `${data.study.number} · ${data.study.title} · ${data.status}`,
    pdf: { engine: 'html', template: template('comparative-study'), landscape: true },
  });
}

/** Old PO print: the order to the supplier with rates, VAT and total in words. */
export function purchaseOrderReport(read: PurchaseReadRepository): ReportDefinition {
  return defineReport({
    key: 'scm.purchase-order',
    title: 'Purchase order',
    group: 'Supply chain',
    description: 'One purchase order for the supplier: items, quantities, rates, VAT and the total in words.',
    params: byId,
    async load(params) {
      const order = await read.getOrder(params.id);
      if (!order) throw new NotFoundError('purchase_order');
      return { order, status: STATUS[order.status] ?? order.status };
    },
    describe: (_params, data) => `${data.order.number} · ${data.status}`,
    pdf: { engine: 'html', template: template('purchase-order') },
  });
}
