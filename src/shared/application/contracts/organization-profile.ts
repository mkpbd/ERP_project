import type { ReportHeader } from '../reports.js';

/**
 * The organization's printed identity, published by the administration
 * module (from the tenant record and its logo).
 */
export abstract class OrganizationProfile {
  abstract reportHeader(): Promise<ReportHeader>;
}
