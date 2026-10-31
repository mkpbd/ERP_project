import { randomUUID } from 'node:crypto';
import type { DbContext } from '../../database/drizzle-transaction-manager.js';
import {
  labAntibiotics,
  labCultureMessages,
  labGrowthTypes,
  labOrganisms,
  labReportTemplates,
} from '../../modules/laboratory/infrastructure/persistence/laboratory.schema.js';
import { text } from './account-records.js';
import { noteRejection, type Loader } from './etl.js';
import { plainText } from './history-records.js';
import { isNew, namedLoader } from './loader-kit.js';

/** Old Diag.CSAntibiotics: the antibiogram's antibiotics (their class is set here). */
export const labAntibioticsLoader = (db: DbContext) =>
  namedLoader(db, {
    name: 'lab-antibiotics',
    entity: 'lab-antibiotic',
    query: 'SELECT CAST([Id] AS nvarchar(36)) AS [Id], [Name] FROM [Diag].[CSAntibiotics] WHERE [IsDeleted] = 0',
    existing: () => db.db.select({ id: labAntibiotics.id, name: labAntibiotics.name }).from(labAntibiotics),
    insert: async (row) => {
      await db.db.insert(labAntibiotics).values({ id: row.id, name: row.name });
    },
  });

/** Old Diag.MicroBioBacterias: the organisms a culture isolates. */
export const labOrganismsLoader = (db: DbContext) =>
  namedLoader(db, {
    name: 'lab-organisms',
    entity: 'lab-organism',
    max: 150,
    query: 'SELECT CAST([Id] AS nvarchar(36)) AS [Id], [Name] FROM [Diag].[MicroBioBacterias] WHERE [IsDeleted] = 0',
    existing: () => db.db.select({ id: labOrganisms.id, name: labOrganisms.name }).from(labOrganisms),
    insert: async (row) => {
      await db.db.insert(labOrganisms).values({ id: row.id, name: row.name });
    },
  });

/** Old Diag.CSGrowthTypes. */
export const labGrowthTypesLoader = (db: DbContext) =>
  namedLoader(db, {
    name: 'lab-growth-types',
    entity: 'lab-growth-type',
    query: 'SELECT CAST([Id] AS nvarchar(36)) AS [Id], [Name] FROM [Diag].[CSGrowthTypes] WHERE [IsDeleted] = 0',
    existing: () => db.db.select({ id: labGrowthTypes.id, name: labGrowthTypes.name }).from(labGrowthTypes),
    insert: async (row) => {
      await db.db.insert(labGrowthTypes).values({ id: row.id, name: row.name });
    },
  });

/** Old Diag.CSMessases: the usual closing remarks of a culture report. */
export const labCultureMessagesLoader = (db: DbContext) =>
  namedLoader(db, {
    name: 'lab-culture-messages',
    entity: 'lab-culture-message',
    max: 500,
    query: 'SELECT CAST([Id] AS nvarchar(36)) AS [Id], [Name] FROM [Diag].[CSMessases] WHERE [IsDeleted] = 0',
    existing: () => db.db.select({ id: labCultureMessages.id, name: labCultureMessages.text }).from(labCultureMessages),
    insert: async (row) => {
      await db.db.insert(labCultureMessages).values({ id: row.id, text: row.name });
    },
  });

/**
 * Old Diag.PathologyTemplates: the written reports' templates. The old editor kept HTML; the text is kept here, one
 * paragraph a line. A template with no text, or a name already taken, is left out.
 */
export function labReportTemplatesLoader(db: DbContext): Loader {
  return {
    name: 'lab-report-templates',
    dependsOn: [],
    async run(context, report) {
      const taken = new Map(
        (await db.db.select({ id: labReportTemplates.id, name: labReportTemplates.name }).from(labReportTemplates)).map(
          (row) => [row.name.toLowerCase(), row.id],
        ),
      );
      const rows = await context.source.query<{
        Id: string;
        Name: string | null;
        Description: string | null;
        TemplateContent: string | null;
      }>(
        `SELECT CAST([Id] AS nvarchar(36)) AS [Id], [Name], [Description], [TemplateContent]
          FROM [Diag].[PathologyTemplates] WHERE [IsDeleted] = 0`,
      );
      for (const row of rows) {
        if (!(await isNew(context, report, 'lab-report-template', row.Id))) continue;
        const name = text(row.Name, 150);
        const body = plainText(row.TemplateContent).slice(0, 20_000);
        if (!name) {
          noteRejection(report, row.Id, 'no_name');
          continue;
        }
        if (!body) {
          noteRejection(report, row.Id, 'no_text');
          continue;
        }
        let id = taken.get(name.toLowerCase());
        if (!id) {
          id = randomUUID();
          await db.db.insert(labReportTemplates).values({
            id,
            name,
            description: text(plainText(row.Description), 300),
            body,
          });
          taken.set(name.toLowerCase(), id);
          report.written += 1;
        }
        await context.ids.set('lab-report-template', row.Id, id);
      }
    },
  };
}

export function labLoaders(db: DbContext): Loader[] {
  return [
    labAntibioticsLoader(db),
    labOrganismsLoader(db),
    labGrowthTypesLoader(db),
    labCultureMessagesLoader(db),
    labReportTemplatesLoader(db),
  ];
}
