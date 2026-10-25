import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import type { ChartHead, ChartReadRepository } from '../../application/chart.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));
const LEVELS = ['Nature', 'Category', 'Sub-category', 'Level 4', 'Level 5', 'Account'] as const;

interface ChartRow {
  code: string;
  name: string;
  level: string;
  indent: number;
  heading: boolean;
  kind: string;
  inactive: boolean;
}

/** Old chart of accounts list: every head and account, indented by level. */
export function chartOfAccountsReport(read: ChartReadRepository): ReportDefinition {
  return defineReport({
    key: 'accounts.chart-of-accounts',
    title: 'Chart of accounts',
    group: 'Accounts',
    description: 'Natures, categories, heads and accounts with their codes.',
    params: z.strictObject({}),
    async load() {
      const rows: ChartRow[] = [];
      const walk = (
        node: ChartHead<unknown> | { code: string; name: string; kind: string; isActive: boolean },
        depth: number,
      ) => {
        const isAccount = 'kind' in node;
        rows.push({
          code: node.code ?? '',
          name: node.name,
          level: LEVELS[depth]!,
          indent: 6 + depth * 14,
          heading: depth === 0,
          kind: isAccount ? node.kind : '',
          inactive: isAccount && !node.isActive,
        });
        if (!isAccount) for (const child of node.children as never[]) walk(child, depth + 1);
      };
      for (const nature of (await read.chart()).natures) walk(nature, 0);
      return { rows };
    },
    pdf: { engine: 'html', template: template('chart-of-accounts') },
    xlsx: (data) => ({
      columns: [
        { key: 'code', header: 'Code', width: 14 },
        { key: 'name', header: 'Name', width: 40 },
        { key: 'level', header: 'Level', width: 14 },
        { key: 'kind', header: 'Kind', width: 10 },
      ],
      rows: data.rows.map((row) => ({ ...row })),
    }),
  });
}
