import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { kitchenList, type Kitchen } from '../../application/nutrition.handlers.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));

const STATE_LABELS = {
  to_serve: 'To serve',
  served: 'Served',
  refused: 'Refused',
  nil_by_mouth: 'Nothing by mouth',
  no_order: 'No diet ordered',
} as const;

/** Old canteen food indent / deliverable lists: a meal's patients by ward and bed, with plates per diet. */
export function kitchenListReport(kitchen: Kitchen): ReportDefinition {
  return defineReport({
    key: 'nutrition.kitchen-list',
    title: 'Kitchen list',
    group: 'Nutrition',
    description: 'A meal of a day: admitted patients by ward and bed, their diet, menu and remarks, plates per diet.',
    params: z.strictObject({ day: z.iso.date(), mealTypeId: z.uuid() }),
    async load(params) {
      const list = await kitchenList(kitchen, params.day, params.mealTypeId);
      return {
        ...list,
        rows: list.rows.map((row) => ({ ...row, stateLabel: STATE_LABELS[row.state] })),
      };
    },
    describe: (_params, data) => `${data.mealType.name} · ${data.day}`,
    pdf: { engine: 'html', template: template('kitchen-list') },
    xlsx: (data) => ({
      columns: [
        { key: 'wardName', header: 'Ward', width: 18 },
        { key: 'bedCode', header: 'Bed', width: 8 },
        { key: 'patientName', header: 'Patient', width: 24 },
        { key: 'admissionNumber', header: 'Admission', width: 15 },
        { key: 'planName', header: 'Diet', width: 18 },
        { key: 'menu', header: 'Menu', width: 36 },
        { key: 'remarks', header: 'Remarks', width: 24 },
        { key: 'stateLabel', header: 'State', width: 16 },
      ],
      rows: data.rows,
    }),
  });
}
