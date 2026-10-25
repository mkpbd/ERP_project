import type { z } from 'zod';
import type { Actor } from './actor.js';

/**
 * Reports are defined in code by the module that owns the data: a parameter
 * schema, a data loader and one or more layouts. The reporting module lists
 * them, checks who may run them, renders and audits. Nothing about a report
 * (query, procedure, template path) ever comes from the client.
 */

export type ReportFormat = 'pdf' | 'xlsx';

/** Letterhead on every report (the old RDLC parameters Company, Address, HotLine, Image). */
export interface ReportHeader {
  readonly organizationName: string;
  readonly organizationNameAlt: string | null;
  readonly address: string;
  readonly hotline: string | null;
  /** `data:` URI of the primary logo, or null. */
  readonly logoDataUri: string | null;
}

export interface ReportContext {
  readonly actor: Actor;
  readonly header: ReportHeader;
  readonly generatedAt: Date;
  /** Display name of the user printing (the old PrintedBy). */
  readonly printedBy: string;
  readonly timeZone: string;
}

export type ReportCellFormat = 'text' | 'integer' | 'decimal' | 'money' | 'date' | 'datetime';

/** Tabular form of a report's data, used for spreadsheets. */
export interface ReportTable {
  readonly columns: ReadonlyArray<{
    readonly key: string;
    readonly header: string;
    readonly width?: number;
    readonly format?: ReportCellFormat;
  }>;
  readonly rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
}

/** pdfmake content and page options; built and typed by the module's infrastructure. */
export type PdfmakeDocument = Readonly<Record<string, unknown>>;

export type PdfLayout<TData> =
  | {
      /** Handlebars template rendered by headless Chromium. Use for anything with Bangla text. */
      readonly engine: 'html';
      /** Absolute path of the `.hbs` file. */
      readonly template: string;
      readonly landscape?: boolean;
      readonly pageSize?: 'A4' | 'A5' | 'Letter' | 'Legal';
    }
  | {
      /** pdfmake document, for small receipts and labels in Latin script. */
      readonly engine: 'pdfmake';
      document(data: TData, context: ReportContext): PdfmakeDocument;
    };

export interface ReportDefinition<TParams = unknown, TData = unknown> {
  /** `<module>.<report>`, e.g. `pharmacy.stock-summary`. */
  readonly key: string;
  readonly title: string;
  /** Menu group (the old ReportAndSps.GroupName). */
  readonly group: string;
  readonly description: string;
  readonly params: z.ZodType<TParams>;
  load(params: TParams, context: ReportContext): Promise<TData>;
  /** One line describing the chosen filters, printed under the title. */
  describe?(params: TParams, data: TData): string;
  readonly pdf?: PdfLayout<TData>;
  xlsx?(data: TData): ReportTable;
}

/** Keeps parameter and data types linked while defining a report. */
export function defineReport<TParams, TData>(definition: ReportDefinition<TParams, TData>): ReportDefinition {
  return definition;
}

export function formatsOf(definition: ReportDefinition): ReportFormat[] {
  return [...(definition.pdf ? (['pdf'] as const) : []), ...(definition.xlsx ? (['xlsx'] as const) : [])];
}

const REPORT_KEY = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;

export class ReportRegistry {
  private readonly reports = new Map<string, ReportDefinition>();

  register(definition: ReportDefinition): void {
    if (!REPORT_KEY.test(definition.key)) throw new Error(`Invalid report key ${definition.key}`);
    if (this.reports.has(definition.key)) throw new Error(`Report ${definition.key} is registered twice`);
    if (formatsOf(definition).length === 0) throw new Error(`Report ${definition.key} has no output format`);
    this.reports.set(definition.key, definition);
  }

  get(key: string): ReportDefinition | undefined {
    return this.reports.get(key);
  }

  all(): ReportDefinition[] {
    return [...this.reports.values()].sort((a, b) => a.group.localeCompare(b.group) || a.title.localeCompare(b.title));
  }
}
