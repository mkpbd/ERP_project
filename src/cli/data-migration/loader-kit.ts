import { randomUUID } from 'node:crypto';
import type { DbContext } from '../../database/drizzle-transaction-manager.js';
import { text } from './account-records.js';
import { noteRejection, type EtlContext, type Loader, type LoaderReport } from './etl.js';

export const NIL = '00000000-0000-0000-0000-000000000000';

/** Pages of an old table in key order: the query takes @after (the last key read) and @n (the page size). */
export async function* pages<T extends Record<string, unknown>>(
  context: EtlContext,
  query: string,
  key: (row: T) => string,
): AsyncGenerator<T[]> {
  let after = NIL;
  for (;;) {
    const rows = await context.source.query<T>(query, { after, n: context.batchSize });
    if (rows.length === 0) return;
    yield rows;
    after = key(rows[rows.length - 1]!);
    if (rows.length < context.batchSize) return;
  }
}

/** Counts a row read; skips it (counting it kept) when it was brought over before. */
export async function isNew(context: EtlContext, report: LoaderReport, entity: string, id: string): Promise<boolean> {
  report.read += 1;
  if (await context.ids.has(entity, id)) {
    report.kept += 1;
    return false;
  }
  return true;
}

/**
 * A named record, optionally under a parent, matched by name (within the parent when names are unique per parent),
 * else made. Old ids (Guids or ints) are kept as text in the id map. The query returns Id, Name and, with a parent,
 * Parent.
 */
export function namedLoader(
  db: DbContext,
  spec: {
    name: string;
    entity: string;
    dependsOn?: { loader: string; entity: string; optional?: boolean };
    query: string;
    /** The longest name kept (default 100). */
    max?: number;
    existing: () => Promise<{ id: string; name: string; parentId?: string | null }[]>;
    /** Names unique within the parent (true) or across the table (false). */
    perParent?: boolean;
    insert: (row: Record<string, unknown> & { id: string; name: string; parentId: string | null }) => Promise<void>;
  },
): Loader {
  return {
    name: spec.name,
    dependsOn: spec.dependsOn ? [spec.dependsOn.loader] : [],
    async run(context, report) {
      const key = (name: string, parentId: string | null | undefined) =>
        spec.perParent ? `${parentId ?? ''}|${name.toLowerCase()}` : name.toLowerCase();
      const existing = new Map((await spec.existing()).map((row) => [key(row.name, row.parentId), row.id]));
      const rows = await context.source.query<{
        Id: number | string;
        Name: string | null;
        Parent?: number | string | null;
      }>(spec.query);
      for (const row of rows) {
        const oldId = String(row.Id);
        if (!(await isNew(context, report, spec.entity, oldId))) continue;
        let parentId: string | null = null;
        if (spec.dependsOn) {
          const parent = row.Parent === null || row.Parent === undefined ? null : String(row.Parent);
          parentId = parent && parent !== NIL ? await context.ids.get(spec.dependsOn.entity, parent) : null;
          if (!parentId && !(spec.dependsOn.optional && (!parent || parent === NIL))) {
            noteRejection(report, oldId, 'parent_not_brought');
            continue;
          }
        }
        const name = text(row.Name, spec.max ?? 100);
        if (!name) {
          noteRejection(report, oldId, 'no_name');
          continue;
        }
        let id = existing.get(key(name, parentId));
        if (!id) {
          id = randomUUID();
          await spec.insert({ ...row, id, name, parentId });
          existing.set(key(name, parentId), id);
          report.written += 1;
        }
        await context.ids.set(spec.entity, oldId, id);
      }
    },
  };
}
