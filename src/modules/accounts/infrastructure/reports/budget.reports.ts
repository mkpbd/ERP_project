import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { budgetView, type BudgetRepository } from '../../application/budget.js';
import type { BooksReadRepository } from '../../application/statements.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));

/** Budget against actual for a fiscal year so far (the old budget page had no such report). */
export function budgetReport(budgets: BudgetRepository, books: BooksReadRepository): ReportDefinition {
  return defineReport({
    key: 'accounts.budget-vs-actual',
    title: 'Budget against actual',
    group: 'Accounts',
    description:
      "Each income and expense account's budget for the year, what was posted, the difference and the share used.",
    params: z.strictObject({ fiscalYearId: z.uuid(), to: z.iso.date().optional() }),
    async load(params) {
      const view = await budgetView(budgets, books, params.fiscalYearId, params.to ?? null);
      return {
        ...view,
        sections: (['income', 'expense'] as const).map((side) => ({
          title: side === 'income' ? 'Income' : 'Expenses',
          lines: view.lines.filter((line) => line.side === side),
          total: view[side],
        })),
      };
    },
    describe: (_params, data) => `${data.fiscalYear.label} to ${data.to}`,
    pdf: { engine: 'html', template: template('budget-vs-actual') },
    xlsx: (data) => ({
      columns: [
        { key: 'code', header: 'Code', width: 12 },
        { key: 'name', header: 'Account', width: 34 },
        { key: 'side', header: 'Side', width: 10 },
        { key: 'budget', header: 'Budget', format: 'money' },
        { key: 'actual', header: 'Actual', format: 'money' },
        { key: 'variance', header: 'Actual less budget', format: 'money' },
        { key: 'usedPercent', header: 'Used %', width: 10 },
      ],
      rows: data.lines.map((line) => ({ ...line })),
    }),
  });
}
