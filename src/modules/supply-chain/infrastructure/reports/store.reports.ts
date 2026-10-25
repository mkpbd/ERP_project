import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import type { StoreReadRepository } from '../../application/store.messages.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));
const byId = z.strictObject({ id: z.uuid() });
const STATUS: Record<string, string> = {
  draft: 'Draft',
  pending: 'Waiting for approval',
  approved: 'Approved',
  partially_served: 'Partly served',
  served: 'Served',
  acknowledged: 'Received by the department',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  completed: 'Completed',
};
const KIND: Record<string, string> = {
  main_to_sub: 'Main store to sub-store',
  sub_to_main: 'Return to main store',
  sub_to_sub: 'Sub-store to sub-store',
};

/** Old store indent print: the indent with requested, approved and served quantities. */
export function storeIndentReport(read: StoreReadRepository): ReportDefinition {
  return defineReport({
    key: 'scm.store-indent',
    title: 'Store indent',
    group: 'Supply chain',
    description: 'One store indent: items with requested, approved and served quantities, and its approvals.',
    params: byId,
    async load(params) {
      const indent = await read.getIndent(params.id);
      if (!indent) throw new NotFoundError('store_indent');
      return { indent, status: STATUS[indent.status] ?? indent.status, priority: indent.priority.replace('_', ' ') };
    },
    describe: (_params, data) => `${data.indent.number} · ${data.status}`,
    pdf: { engine: 'html', template: template('store-indent') },
  });
}

/** Old issue slip: what a department took from a sub-store, by lot, for signatures. */
export function storeIssueReport(read: StoreReadRepository): ReportDefinition {
  return defineReport({
    key: 'scm.store-issue',
    title: 'Issue slip',
    group: 'Supply chain',
    description: 'One issue to a department: items and lots taken, with value, and space for signatures.',
    params: byId,
    async load(params) {
      const issue = await read.getIssue(params.id);
      if (!issue) throw new NotFoundError('store_issue');
      const parts = issue.parts.map((part) => ({ ...part, value: Math.round(part.qty * part.unitCost * 100) / 100 }));
      return { issue: { ...issue, parts } };
    },
    describe: (_params, data) => `${data.issue.number} · ${data.issue.subStoreName} to ${data.issue.departmentName}`,
    pdf: { engine: 'html', template: template('store-issue') },
  });
}

/** Old transfer prints (TRF-…): what went from one store to another, by lot. */
export function stockTransferReport(read: StoreReadRepository): ReportDefinition {
  return defineReport({
    key: 'scm.stock-transfer',
    title: 'Stock transfer',
    group: 'Supply chain',
    description: 'One transfer between stores: items sent and accepted, the lots moved, with value.',
    params: byId,
    async load(params) {
      const transfer = await read.getTransfer(params.id);
      if (!transfer) throw new NotFoundError('stock_transfer');
      return {
        transfer,
        kind: KIND[transfer.kind] ?? transfer.kind,
        status: STATUS[transfer.status] ?? transfer.status,
      };
    },
    describe: (_params, data) => `${data.transfer.number} · ${data.kind} · ${data.status}`,
    pdf: { engine: 'html', template: template('stock-transfer') },
  });
}
