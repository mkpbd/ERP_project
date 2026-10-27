import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { InpatientRegister } from '../../../../shared/application/contracts/inpatient-register.js';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import type { WardReadRepository } from '../../application/ward.messages.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));
const cents = (value: number) => Math.round(value * 100) / 100;

/**
 * Old PrintIPDInvoiceDetailsForBillDocument / PrintMedicineBillSummaryDocument (spGetIPDMedicineBill): every unit sent
 * to the wards for one admission and every unit sent back, with what stays charged to the stay.
 */
export function wardMedicineReport(read: WardReadRepository, register: InpatientRegister): ReportDefinition {
  return defineReport({
    key: 'pharmacy.ward-medicine',
    title: 'Ward medicine',
    group: 'Pharmacy',
    description: "An admitted patient's medicine sent to the ward and sent back, line by line, with the net charged.",
    params: z.strictObject({ admissionId: z.uuid() }),
    async load(params) {
      const [admission] = await register.find([params.admissionId]);
      if (!admission) throw new NotFoundError('admission');
      const lines = (await read.medicineOf(params.admissionId)).map((line) => ({
        ...line,
        kindLabel: line.kind === 'issue' ? 'Sent' : 'Returned',
      }));
      const sum = (kind: 'issue' | 'return') =>
        cents(lines.filter((line) => line.kind === kind).reduce((total, line) => total + line.total, 0));
      const issued = sum('issue');
      const returned = sum('return');
      return { admission, lines, issued, returned: -returned, net: cents(issued + returned) };
    },
    describe: (_params, data) => `${data.admission.number} · ${data.admission.patientName}`,
    pdf: { engine: 'html', template: template('ward-medicine') },
    xlsx: (data) => ({
      columns: [
        { key: 'on', header: 'Date', format: 'date' },
        { key: 'number', header: 'Document', width: 16 },
        { key: 'kindLabel', header: 'Entry', width: 10 },
        { key: 'outletName', header: 'Outlet', width: 16 },
        { key: 'productName', header: 'Medicine', width: 34 },
        { key: 'qty', header: 'Qty', format: 'integer' },
        { key: 'saleRate', header: 'Rate', format: 'money' },
        { key: 'total', header: 'Charged', format: 'money' },
      ],
      rows: data.lines,
    }),
  });
}
