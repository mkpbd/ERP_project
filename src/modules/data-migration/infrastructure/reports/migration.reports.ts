import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { DomainError, NotFoundError } from '../../../../shared/domain/errors.js';
import { reconciliationOf, type MigrationReadRepository } from '../../application/migration.queries.js';

/** Counts as whole numbers, amounts with paisa; nothing as a dash. */
const figure = (value: number | null) =>
  value === null
    ? '—'
    : value.toLocaleString(
        'en-US',
        Number.isInteger(value) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 },
      );

const VERDICTS: Record<string, string> = {
  go: 'Go: everything agrees',
  'go-with-notes': 'Go, with the differences below explained',
  'no-go': 'No go: the books do not agree',
};

/**
 * The cut-over reconciliation (`npm run etl -- --reconcile`): the old system and this one side by side, area by area,
 * with the verdict and lines to sign.
 */
export function reconciliationReport(read: MigrationReadRepository): ReportDefinition {
  return defineReport({
    key: 'data-migration.reconciliation',
    title: 'Cut-over reconciliation',
    group: 'Administration',
    description: 'The old system and this one side by side at the cut-over, to sign before going live.',
    params: z.strictObject({ runId: z.uuid() }),
    async load(params, report) {
      const run = await read.run(params.runId);
      if (!run) throw new NotFoundError('migration_run');
      const reconciliation = reconciliationOf(run);
      if (!reconciliation) throw new DomainError('not_a_reconciliation', 'The run is not a reconciliation');
      return {
        organization: report.header,
        ...reconciliation,
        verdictLabel: VERDICTS[reconciliation.verdict] ?? reconciliation.verdict,
        checks: reconciliation.checks.map((check) => ({
          ...check,
          oldText: figure(check.old),
          newText: figure(check.new),
          statusLabel: check.status === 'ok' ? 'Agrees' : check.status === 'check' ? 'Explain' : 'Fails',
        })),
      };
    },
    describe: (_params, data) => `Cut-over ${data.cutOver} · ${data.verdictLabel}`,
    pdf: { engine: 'html', template: fileURLToPath(new URL('./reconciliation.hbs', import.meta.url)) },
  });
}
