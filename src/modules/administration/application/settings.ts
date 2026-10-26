/**
 * Application-wide settings documents. Each is one JSON object stored under
 * its key; reads return the defaults overlaid with what was saved, so new
 * fields get their default without a data migration.
 */

/** Old API: SuperAdmin.AppSettings. Fields keep their meaning; names are camelCase and clearer. */
export const GENERAL_SETTINGS_DEFAULTS = {
  jsPrintManagerUrl: null as string | null,
  dailyFoodBillInWard: 0,
  dailyFoodBillInOthers: 0,
  visitingCardRate: 0,
  vatRegistrationNo: null as string | null,
  ipdServiceChargePercent: 0,
  autoInvestigationInvoiceAfterIndent: false,
  autoAddTubeAndNeedle: false,
  menuBackgroundColor: null as string | null,
  sampleDispatchDelayMinutes: 0,
  autoAppointmentSerial: false,
  addTechnologistSignatureOnReport: false,
  integratedAccountsEnabled: false,
  stockEntryGrandTotalDisabled: false,
  /** Old AppConstant.InvPrefix ("FKH"): printed before UHIDs on cards and lists; the number is stored without it. */
  uhidPrefix: null as string | null,
};
export type GeneralSettings = typeof GENERAL_SETTINGS_DEFAULTS;

/** Old API: Admin.EditorMargins (page margins of the report editor, CSS lengths). */
export const EDITOR_MARGINS_DEFAULTS = { left: '', right: '', top: '', bottom: '' };
export type EditorMargins = typeof EDITOR_MARGINS_DEFAULTS;

export const SETTINGS_DEFAULTS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  general: GENERAL_SETTINGS_DEFAULTS,
  'editor-margins': EDITOR_MARGINS_DEFAULTS,
};

/** Defaults overlaid with stored values; stored keys that are no longer defined are dropped. */
export function effectiveSettings(key: string, stored: Record<string, unknown> | null): Record<string, unknown> {
  const defaults = SETTINGS_DEFAULTS[key];
  if (!defaults) throw new Error(`Unknown settings document ${key}`);
  const result: Record<string, unknown> = { ...defaults };
  for (const field of Object.keys(defaults)) if (stored && field in stored) result[field] = stored[field];
  return result;
}
