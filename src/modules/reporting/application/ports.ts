import type { ReportContext, ReportDefinition, ReportFormat } from '../../../shared/application/reports.js';

export interface RenderRequest {
  readonly definition: ReportDefinition;
  readonly data: unknown;
  readonly context: ReportContext;
  readonly format: ReportFormat;
  /** Filter summary printed under the title. */
  readonly filters: string;
}

export interface RenderedFile {
  readonly contentType: string;
  readonly data: Uint8Array;
}

export abstract class ReportRenderer {
  abstract render(request: RenderRequest): Promise<RenderedFile>;
}

export interface ReportingSettings {
  readonly timeZone: string;
}

export const REPORTING_SETTINGS = Symbol('REPORTING_SETTINGS');

export const REPORTS_ACCESS_ALL = 'reports:access-all';
