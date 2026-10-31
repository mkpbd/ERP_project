import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import type { SaleReadRepository, SaleSummary } from '../../application/sale.messages.js';

/** Names the company and the staff member of rows (the sale desk asks the hospital and HR). */
type Namer = <T extends Pick<SaleSummary, 'corporateClientId' | 'staffId'>>(
  rows: readonly T[],
) => Promise<(T & { corporateClientName: string | null; staffName: string | null })[]>;

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));

/** Old PrintPharmacyInvoiceRecieptDocument: the customer's receipt, on an 80 mm roll. */
export function saleReceiptReport(read: SaleReadRepository, named: Namer): ReportDefinition {
  return defineReport({
    key: 'pharmacy.sale-receipt',
    title: 'Medicine sale receipt',
    group: 'Pharmacy',
    description: "One sale's receipt: medicines with batch and expiry, rates, discounts, paid, change and due.",
    params: z.strictObject({ id: z.uuid() }),
    async load(params, report) {
      const found = await read.getSale(params.id);
      if (!found) throw new NotFoundError('sale');
      const [sale] = await named([found]);
      return { sale: sale!, organization: report.header.organizationName, printedBy: report.printedBy };
    },
    describe: (_params, data) => data.sale.number,
    pdf: { engine: 'html', template: template('sale-receipt'), bare: true, paper: { width: '80mm', height: '200mm' } },
  });
}

/**
 * Old due collection receipts (loyal member, corporate client, staff): what was paid, how, by whom, and the sales it
 * settled, on an 80 mm roll.
 */
export function dueReceiptReport(read: SaleReadRepository, named: Namer): ReportDefinition {
  return defineReport({
    key: 'pharmacy.due-receipt',
    title: 'Due collection receipt',
    group: 'Pharmacy',
    description: 'A payment against dues: the payer (member, company or staff), the amount and the sales it settled.',
    params: z.strictObject({ id: z.uuid() }),
    async load(params, report) {
      const found = await read.collection(params.id);
      if (!found) throw new NotFoundError('due_collection');
      const [collection] = await named([found]);
      return { collection: collection!, organization: report.header.organizationName, printedBy: report.printedBy };
    },
    describe: (_params, data) => data.collection.number,
    pdf: { engine: 'html', template: template('due-receipt'), bare: true, paper: { width: '80mm', height: '160mm' } },
  });
}

/** Old PrinLoyalMemberDueRecieptDocument: what a loyal member still owes, sale by sale. */
export function memberDuesReport(read: SaleReadRepository): ReportDefinition {
  return defineReport({
    key: 'pharmacy.member-dues',
    title: 'Loyal member dues',
    group: 'Pharmacy',
    description: "A loyal member's unpaid sales with what was collected and what is still due.",
    params: z.strictObject({ loyalMemberId: z.uuid() }),
    async load(params) {
      const dues = await read.memberDues(params.loyalMemberId);
      if (!dues) throw new NotFoundError('loyal_member');
      const sales = dues.sales.map((sale) => ({
        ...sale,
        stillDue: Math.round((sale.due - sale.collected) * 100) / 100,
      }));
      return { dues: { ...dues, sales } };
    },
    describe: (_params, data) => `${data.dues.name} · ${data.dues.contactNo}`,
    pdf: { engine: 'html', template: template('member-dues') },
  });
}
