import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import type { DepartmentReadRepository } from '../../application/department.messages.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));
const byId = z.strictObject({ id: z.uuid() });

/** Old supplier return print: what went back, at what cost, and what came in its place. */
export function supplierReturnReport(read: DepartmentReadRepository): ReportDefinition {
  return defineReport({
    key: 'scm.supplier-return',
    title: 'Return to supplier',
    group: 'Supply chain',
    description: 'One supplier return: items and lots sent back with their value, and what the supplier sent back.',
    params: byId,
    async load(params) {
      const document = await read.get('supplier_return', params.id);
      if (!document) throw new NotFoundError('supplier_return');
      const parts = document.parts.map((part) => ({
        ...part,
        value: Math.round(part.qty * part.unitCost * 100) / 100,
      }));
      return { document: { ...document, parts } };
    },
    describe: (_params, data) => `${data.document.number} · ${data.document.partyName} · ${data.document.status}`,
    pdf: { engine: 'html', template: template('supplier-return') },
  });
}

/** Old gate pass print. */
export function gatePassReport(read: DepartmentReadRepository): ReportDefinition {
  return defineReport({
    key: 'scm.gate-pass',
    title: 'Gate pass',
    group: 'Supply chain',
    description: 'One gate pass for goods leaving the premises, with signature lines.',
    params: byId,
    async load(params) {
      const pass = await read.get('gate_pass', params.id);
      if (!pass) throw new NotFoundError('gate_pass');
      return { pass, kind: pass.status.replace('_', ' ') };
    },
    describe: (_params, data) => data.pass.number,
    pdf: { engine: 'html', template: template('gate-pass') },
  });
}
