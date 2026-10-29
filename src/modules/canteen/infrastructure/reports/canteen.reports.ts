import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { DomainError, NotFoundError } from '../../../../shared/domain/errors.js';
import type { CanteenReadRepository } from '../../application/canteen.messages.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));
const day = z.iso.date();
const CUSTOMER_LABELS = { walk_in: 'Walk-in', staff: 'Staff', member: 'Member' } as const;

/** Old canteen sale invoice print: the receipt handed over the counter. */
export function canteenReceiptReport(read: CanteenReadRepository): ReportDefinition {
  return defineReport({
    key: 'canteen.receipt',
    title: 'Canteen receipt',
    group: 'Canteen',
    description: 'A canteen sale: items, VAT, discount, paid and due.',
    params: z.strictObject({ saleId: z.uuid() }),
    async load(params, report) {
      const sale = await read.sale(params.saleId);
      if (!sale) throw new NotFoundError('canteen_sale');
      return { organization: report.header, sale, customerLabel: CUSTOMER_LABELS[sale.customerKind] };
    },
    describe: (_params, data) => data.sale.number,
    pdf: { engine: 'html', template: template('receipt'), bare: true, paper: { width: '80mm', height: '200mm' } },
  });
}

/** Old canteen item-wise sales: quantity, amount and VAT per item over the days, at one outlet or all. */
export function canteenItemSalesReport(read: CanteenReadRepository): ReportDefinition {
  return defineReport({
    key: 'canteen.item-sales',
    title: 'Canteen sales by item',
    group: 'Canteen',
    description: 'Items sold over a period (cancelled sales left out): quantity, amount and VAT, by group.',
    params: z.strictObject({ from: day, to: day, outletId: z.uuid().optional() }),
    async load(params) {
      if (params.from > params.to) throw new DomainError('invalid_period', 'The start date is after the end date');
      const rows = await read.itemSales(params.from, params.to, params.outletId ?? null);
      const total = (key: 'amount' | 'vat') => Math.round(rows.reduce((sum, row) => sum + row[key], 0) * 100) / 100;
      return { rows, totals: { amount: total('amount'), vat: total('vat') } };
    },
    describe: (params) => `${params.from} to ${params.to}`,
    pdf: { engine: 'html', template: template('item-sales') },
    xlsx: (data) => ({
      columns: [
        { key: 'groupName', header: 'Group', width: 18 },
        { key: 'itemName', header: 'Item', width: 30 },
        { key: 'qty', header: 'Quantity', format: 'decimal' },
        { key: 'amount', header: 'Amount', format: 'money' },
        { key: 'vat', header: 'VAT', format: 'money' },
      ],
      rows: data.rows,
    }),
  });
}

/** Old LoyalMemberLedger dues: members owing the canteen, most owed first. */
export function canteenMemberDuesReport(read: CanteenReadRepository): ReportDefinition {
  return defineReport({
    key: 'canteen.member-dues',
    title: 'Canteen member dues',
    group: 'Canteen',
    description: 'Members owing the canteen and how much.',
    params: z.strictObject({}),
    async load() {
      const rows = await read.dues();
      return { rows, total: Math.round(rows.reduce((sum, row) => sum + row.balance, 0) * 100) / 100 };
    },
    pdf: { engine: 'html', template: template('member-dues') },
    xlsx: (data) => ({
      columns: [
        { key: 'name', header: 'Member', width: 28 },
        { key: 'mobileNo', header: 'Mobile', width: 14 },
        { key: 'balance', header: 'Owes', format: 'money' },
      ],
      rows: data.rows,
    }),
  });
}
